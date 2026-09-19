import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Users, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: resetError } = await resetPassword(email)
    if (resetError) {
      setError(resetError)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
            <Users className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">Reset your password</h1>
            <p className="mt-1 text-sm text-gray-500">
              {sent ? 'Check your inbox for the reset link' : 'Enter your email and we\'ll send you a reset link'}
            </p>
          </div>
        </div>

        {sent ? (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-50 text-accent-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <p className="text-sm text-gray-700">
                We sent a password reset link to <span className="font-medium text-gray-900">{email}</span>.
                Click the link in the email to set a new password.
              </p>
            </div>
            <Link to="/login">
              <Button variant="secondary" className="w-full">
                <ArrowLeft className="h-4 w-4" /> Back to sign in
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@company.com"
                  required
                  className="pl-9"
                />
              </div>
            </div>

            {error && (
              <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{error}</div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Sending reset link…' : 'Send reset link'}
            </Button>
          </form>
        )}

        {!sent && (
          <p className="mt-4 text-center text-sm text-gray-500">
            Remember your password?{' '}
            <Link to="/login" className="font-medium text-primary-600 hover:text-primary-700">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
