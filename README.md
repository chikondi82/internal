# Internal Workspace

## Enable the workspace assistant

The workspace assistant uses GroqCloud's OpenAI-compatible API with the
`openai/gpt-oss-20b` model. Copy `.env.example` to `.env`, add your Groq API
key, then start or restart the app:

```powershell
Copy-Item .env.example .env
# Edit .env and set GROQ_API_KEY to your key.
npm start
```

The local `.env` file is ignored by Git. Keep the key there on the server;
never add it to browser code or commit it. The server verifies Firebase
sign-in tokens for the configured project before making requests, and limits
each signed-in user to 12 assistant requests per minute.

The assistant can answer general work questions, summarize the recent context
on the current page, help plan next steps, and draft chat messages or company
feed updates. It currently receives up to 12 recent messages from the open chat
or 8 recent posts from the feed. This context and the conversation with the
assistant are sent to GroqCloud; review Groq's current privacy, usage, model
availability, and pricing terms before production use. Free-tier availability
and limits can change; check the current GroqCloud account limits.

The assistant cannot independently search all workspace history or perform
workspace actions. Drafts are placed in the appropriate composer only after
the user selects **Use draft**; messages and posts are never sent automatically.
Review all AI responses and drafts before relying on or sharing them.

## Direct Messages directory

The Direct Messages roster is populated from the users currently registered in
Firebase Authentication. When a signed-in teammate opens the dashboard, the
server syncs their basic directory details (name, email, and photo) into Firestore
so everyone can find and start a private conversation with them. This does not
create, restore, or change Firebase Authentication accounts, and it preserves
existing Firestore profile details.

The server needs Firebase Admin credentials for the `whatsapp-internal-4a29f`
project. Set `FIREBASE_SERVICE_ACCOUNT` to the service-account JSON as a server
environment secret (for example, in Render); do not put the key in browser code
or commit it. The service account needs Firebase Authentication user-listing
access and Firestore write access. Local development may instead use Application
Default Credentials. The administrator's Firebase email must be verified.

Workspace admins can add regular users from **Reports & evaluations → Add a
workspace user**. The server creates the account with a random, undisclosed
password; Firebase Authentication then emails the user a password-reset link to
choose their own password. Admin invitations require verified admin accounts
and Firebase Admin access to create/delete Authentication users and write user
profiles in Firestore. Configure the Firebase Authentication password-reset
email template and authorize the app's domain in Firebase Authentication so the
setup link can return to the sign-in page. Delegated admins cannot grant admin
access to invited users.

Direct messages allow members assigned to the same organization group to start
conversations. Starting a DM across groups sends a message request; the recipient
must accept before either member can read or send messages. Members without a
group assignment also need approval. Enabled workspace admins and the six
Super-Admin-confirmed accounts in **Reports & evaluations → Trusted DM
exceptions** can start conversations with any member. Existing DM histories
are treated as already established. The user directory remains visible.

This feature requires publishing the updated `firestore.rules` rules in the
Firebase Console and deploying the updated `server.js` API plus the Netlify
redirects. The Super Admin must select and save the six existing accounts in
the trusted-exceptions panel before those accounts receive the exemption.
The client retries temporary API gateway failures while Render starts. For
immediate DM availability after idle periods, keep the Render web service on an
always-on plan; free instances can sleep and take about a minute to restart.

The high visibility toggle saves its setting in the current browser's local
storage and applies across the app pages on that browser. It sits beside the
sign-out control in the dashboard and HR app.

## Vialifecoach Global Foundation application platform

The VGF platform is integrated into the existing Netlify, Firebase and Render
deployment. Public visitors can browse published opportunities at
`/programmes.html`, register or sign in at `/vgf-applicant.html`, complete a
localized dynamic application, save drafts, upload private supporting
documents, submit, track status, read notifications and withdraw an
application. Programme application forms support English, French, Kiswahili,
Kirundi and Kinyarwanda. Partner users use `/vgf-partner.html` to review only
applications for programmes assigned to their organization, subject to their
membership role and per-programme permissions. The verified Super Admin uses
`/vgf-admin.html` to manage programmes, form questions, document requirements,
partner assignments, representatives, review decisions, analytics, audit
records, privacy/retention notices and localized email templates.

All privileged VGF operations go through `/api/vgf/*` in `server.js`. Firestore
stores application records, grants and audit history; uploaded files are kept
in private Cloud Storage paths. The API checks Firebase ID tokens, role claims,
applicant ownership, partner membership, programme grants and reviewer
assignment before returning records or files. Applicant and partner accounts
are isolated from internal workspace APIs and collections. VGF Firestore
records are not directly writable by browser clients. Application submission
requires the selected language's privacy notice and retention text to be
configured by the administrator.

### Deployment and service configuration

Deploy the updated `server.js` to Render, the static pages and `/api/vgf/*`
proxy to Netlify, and `firestore.rules`, `storage.rules`, and
`firestore.indexes.json` to Firebase. Configure Firebase Authentication email
and password sign-in, authorize the public app domain, and configure the
Firebase Admin service account and Storage bucket on Render. Add `RESEND_API_KEY`,
`VGF_EMAIL_FROM`, `VGF_EMAIL_REPLY_TO`, and `VGF_APP_ORIGIN` to the Render environment so registration,
verification, password reset, invitations and application notifications can
send mail. `VGF_APP_ORIGIN` must be the deployed public origin. See `.env.example`
for the variable names; keep actual credentials in the deployment secret store.

After deploying the restrictive Firestore rules, existing internal staff need
the `vgfWorkspace` custom claim. Sign in as Super Admin at `/vgf-admin.html`,
preview the account migration, review the eligible count, then confirm it.
Applicants, partner representatives and VGF memberships are excluded. Newly
invited workspace accounts receive the claim through the existing server
invitation flow. Staff need to sign out and sign back in after claims change.
The administrator must also configure the privacy notice, retention statement,
contact email and notification templates in each language the platform will
use before opening applications. Archive programmes instead of deleting ones
with application history.

## HR CRM

The private HR app is available at `/hr.html`. Only the Super Admin can create
HR invitations. Each invitation is a one-time link that expires after seven
days; the invited person must sign in with the exact invited email and verify
it before the server grants the separate `hrAccess` role. The Super Admin can
revoke an invitation or HR access from the app. HR access is independent from
workspace-admin access.

The HR workspace includes a people directory, onboarding task tracking, leave
request recording and approvals, a policy library, HR access management, and a
private worker-message inbox. Workers use **My HR** in the workspace to see
their linked work profile, onboarding tasks, leave updates, published policies,
notifications, and private case conversations. Notifications and case
messages update live while the worker is signed in; unread notifications remain
available when they return. While in the main workspace, workers also see an
unread badge and alert for new HR updates. Workers can submit and reply to
cases, and HR replies appear in that worker's thread. HR changes are tied to a
worker only after HR links the employee record to that person's workspace
account.

HR staff also have an **HR leadership** dropdown inside the private HR CRM.
It provides weekly reports for sharing accomplishments, upcoming priorities,
and challenges, plus a direct **Ask for help** option for starting a private
support discussion at any time. Help requests include a category, priority,
optional needed-by date, and the specific support or decision requested. Both
use private reply threads and follow-up statuses for the Super Admin and
authorized HR staff only; workspace admins without HR access and employees
cannot read or write these reports. This is separate from employee My HR and
worker support cases.

Workers whose workspace account is not yet linked to an HR employee record can
request My HR access from the My HR page. The request is visible to authorized
HR staff and the Super Admin, who must select the matching unlinked employee
record to approve it or provide a reason to reject it. Only approval links the
account and unlocks employee HR data. Link requests are written through the
authenticated server API; Firestore clients cannot create or modify them.

The worker view does not expose the HR directory or other workers' records.
HR-only employee, onboarding, and leave records remain restricted to enabled
HR accounts and the Super Admin; case conversations are readable only by HR
and the case's worker, and only published policies are visible to workers.
Payroll, bank details, government IDs, and medical records are out of scope.
Publish the updated `firestore.rules`, deploy the Netlify redirects and
`server.js` API, and make sure the server has valid Firebase Admin credentials
before using the connected workflows in production. In-app updates require an
active signed-in session; email or push delivery is not configured.
