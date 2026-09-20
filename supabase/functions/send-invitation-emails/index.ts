// Drains organization_invitation_emails and sends each queued invitation.
//
// Runs with the service role, so it reads the queue and the invitation detail
// directly; none of the RLS policies apply to it and none are relaxed for it.
//
// Provider: Resend. Rally had no email provider configured, so one had to be
// introduced. Swapping it means replacing `sendEmail` below and one secret.
// Supabase Auth's own mail was not an option: GoTrue composes its own
// messages, and `inviteUserByEmail` creates a user account as a side effect,
// which the invitation model forbids.
//
// Required secrets:
//   RESEND_API_KEY   provider credential
//   INVITE_FROM      verified sender, e.g. "Rally <invites@yourdomain>"
//   APP_URL          public origin of the app, e.g. https://rally.example
//
// Failure is recorded on the queue row and reported in the response. It is
// never reported as success, and a failure never touches the invitation.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const INVITE_FROM = Deno.env.get('INVITE_FROM') ?? 'Rally <onboarding@resend.dev>'
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')

const BATCH_SIZE = 25
const MAX_ATTEMPTS = 5

type QueueRow = {
  id: string
  invitation_id: string
  recipient_email: string
  attempts: number
  organization_invitations: {
    role: string
    status: string
    expires_at: string
    organizations: { name: string } | null
  } | null
}

function db(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Event manager',
}

function renderEmail(opts: {
  organization: string
  role: string
  expiresAt: string
  reviewUrl: string
}): { subject: string; html: string; text: string } {
  const org = escapeHtml(opts.organization)
  const role = escapeHtml(ROLE_LABELS[opts.role] ?? opts.role)
  const expires = new Date(opts.expiresAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const subject = `You've been invited to join ${opts.organization} on Rally`

  // Deliberately contains only what the recipient needs: who invited them, as
  // what, until when, and where to go. No identifiers beyond the invitation's
  // own, and nothing about other people or the database.
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f9fafb;font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
      <tr>
        <td style="padding-bottom:20px;">
          <span style="display:inline-block;background:#0A66C2;color:#ffffff;font-weight:700;font-size:18px;padding:8px 14px;border-radius:8px;">Rally</span>
        </td>
      </tr>
      <tr>
        <td style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;">You've been invited to join ${org}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#374151;">
            ${org} has invited you to join its team on Rally as
            <strong>${role}</strong>. Rally is where the organization runs its
            events and works with the people who attend them.
          </p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#374151;">
            You'll be asked to sign in, or to create an account with this email
            address if you don't have one yet, before you can review it.
          </p>
          <p style="margin:0 0 24px;">
            <a href="${opts.reviewUrl}"
               style="display:inline-block;background:#0A66C2;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">
              Review Invitation
            </a>
          </p>
          <p style="margin:0;font-size:13px;line-height:1.5;color:#6b7280;">
            This invitation expires on ${expires}. If you weren't expecting it,
            you can ignore this email &mdash; nothing happens until you accept.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding-top:16px;font-size:12px;color:#9ca3af;">
          Sent by Rally because ${org} invited this address to its team.
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = [
    `You've been invited to join ${opts.organization} on Rally`,
    '',
    `${opts.organization} has invited you to join its team as ${ROLE_LABELS[opts.role] ?? opts.role}.`,
    '',
    `Review the invitation: ${opts.reviewUrl}`,
    '',
    `You'll be asked to sign in, or to create an account with this email address if you don't have one yet.`,
    `This invitation expires on ${expires}.`,
    '',
    `If you weren't expecting this, you can ignore it - nothing happens until you accept.`,
  ].join('\n')

  return { subject, html, text }
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) {
    // Loudly, not silently: a missing credential is a configuration failure
    // and the queue row must record it as one.
    throw new Error('RESEND_API_KEY is not set on this project')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: INVITE_FROM, to: [to], subject, html, text }),
  })

  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Provider rejected the message (${response.status}): ${body.slice(0, 300)}`)
  }

  try {
    return (JSON.parse(body) as { id?: string }).id ?? null
  } catch {
    return null
  }
}

Deno.serve(async (request) => {
  // Deployed with verify_jwt, so the platform has already rejected anything
  // without a valid JWT - but the anon key is a valid JWT, and this endpoint
  // drains a queue of messages to other people's inboxes. Require the
  // service-role key specifically: it is meant to be invoked by a schedule or
  // a trusted backend, never by the app.
  const presented = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')

  if (presented !== SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Not authorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!APP_URL) {
    return new Response(
      JSON.stringify({ error: 'APP_URL is not set; invitation links cannot be built' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const queued = await db(
    `organization_invitation_emails?status=eq.queued&attempts=lt.${MAX_ATTEMPTS}` +
      `&order=queued_at.asc&limit=${BATCH_SIZE}` +
      `&select=id,invitation_id,recipient_email,attempts,` +
      `organization_invitations(role,status,expires_at,organizations(name))`
  )

  if (!queued.ok) {
    const detail = await queued.text()
    return new Response(JSON.stringify({ error: 'Could not read the queue', detail }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const rows = (await queued.json()) as QueueRow[]
  let sent = 0
  let failed = 0
  let skipped = 0

  for (const row of rows) {
    const invitation = row.organization_invitations
    const attempts = row.attempts + 1

    // The invitation may have been revoked, answered or expired between being
    // queued and being drained. Sending then would be sending an offer that no
    // longer exists.
    if (
      !invitation ||
      invitation.status !== 'pending' ||
      new Date(invitation.expires_at).getTime() <= Date.now()
    ) {
      await db(`organization_invitation_emails?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'failed',
          attempts,
          last_error: 'Invitation was no longer pending when the email was sent',
        }),
      })
      skipped++
      continue
    }

    // The existing invitation route. The id identifies which invitation to
    // show; it grants nothing, because accepting still requires a session
    // whose confirmed email matches invited_email.
    const reviewUrl = `${APP_URL}/organizer/invitations?invitation=${row.invitation_id}`

    const { subject, html, text } = renderEmail({
      organization: invitation.organizations?.name ?? 'a Rally organization',
      role: invitation.role,
      expiresAt: invitation.expires_at,
      reviewUrl,
    })

    try {
      const messageId = await sendEmail(row.recipient_email, subject, html, text)
      await db(`organization_invitation_emails?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'sent',
          attempts,
          sent_at: new Date().toISOString(),
          provider_message_id: messageId,
          last_error: null,
        }),
      })
      sent++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Stays 'queued' until the attempt ceiling, so a transient provider
      // failure is retried on the next run rather than losing the send.
      await db(`organization_invitation_emails?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
          attempts,
          last_error: message.slice(0, 500),
        }),
      })
      failed++
    }
  }

  // A run that failed to deliver anything is not a success.
  const status = failed > 0 && sent === 0 && rows.length > 0 ? 502 : 200
  return new Response(JSON.stringify({ processed: rows.length, sent, failed, skipped }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
})
