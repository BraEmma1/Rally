import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Users, Mail, Lock, User as UserIcon, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { GoogleButton } from '@/components/ui/GoogleButton'

export default function SignUpPage() {
  const { signUp, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    const { error: signUpError } = await signUp(email, password, fullName)
    if (signUpError) {
      setError(signUpError)
      setLoading(false)
      return
    }
    navigate('/dashboard')
  }

  async function handleGoogle() {
    setGoogleError(null)
    setGoogleLoading(true)
    const { error: googleError } = await signInWithGoogle()
    if (googleError) {
      setGoogleError(googleError)
      setGoogleLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-600 text-white">
            <Users className="h-6 w-6" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">Create your Rally account</h1>
            <p className="mt-1 text-sm text-gray-500">Start building your professional network</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
          <GoogleButton onClick={handleGoogle} loading={googleLoading} />
          {googleError && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{googleError}</div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-gray-400">or sign up with email</span>
            </div>
          </div>

          <div>
            <Label htmlFor="fullName">Full name</Label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Smith"
                required
                className="pl-9"
              />
            </div>
          </div>

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

          <div>
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                className="pl-9 pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-error-50 px-3 py-2 text-sm text-error-700">{error}</div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Creating account…' : 'Sign up'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary-600 hover:text-primary-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
