// access texts (en).
export default {
  errors: {
    invalidRelayDomain: 'invalid domain: {domain}',
    empty: '(empty)',
    invalidRelayTarget: '{domain}: the target must be the local IP of the other PC (e.g. 10.0.0.20)',
    invalidRelayIp: 'local IP of the relay PC expected (e.g. 10.0.0.10)',
    passwordTooShort: '12 characters minimum',
    invalidDomain: 'invalid domain name',
    notConfigured: 'remote access not configured',
    wrongPassword: 'wrong password',
    wrongCurrentPassword: 'the current password is wrong',
    tooManyAttempts: 'too many attempts, try again in {minutes} min',
    loginRequired: 'login required',
  },
  // Device name when the browser is not recognised ("Browser · Windows")
  browser: 'Browser',
  // Login page (login.html)
  login: {
    appName: 'Claude Dashboard',
    intro: 'Remote access: master password.',
    password: 'Password',
    submit: 'Log in',
    pendingTitle: 'Waiting for approval',
    pendingBefore: 'Approve this device (',
    pendingAfter: ') from the PC: app notification, or 🔒 Remote access in the dashboard.',
    pendingServer: 'Approve this device from a device already approved (⚙ Options → 🔒 Remote access), or on the server, inside the container:',
    cancel: 'Cancel',
    thisDevice: 'this device',
    unreachable: 'server unreachable',
  },
};
