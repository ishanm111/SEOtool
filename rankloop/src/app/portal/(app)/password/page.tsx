import { PortalHeader } from '../../_components/ui'
import { ChangePasswordForm } from './form'

export const dynamic = 'force-dynamic'

export default function PortalPassword() {
  return (
    <div className="max-w-md space-y-6">
      <PortalHeader title="Password" lede="Change the password you use to sign in here." />
      <ChangePasswordForm />
    </div>
  )
}
