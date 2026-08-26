import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Tashfeen Immigration Solutions',
  description: 'Privacy policy for Tashfeen Immigration Solutions — how we collect, use, and protect your data.',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <section className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
            Privacy Policy
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Tashfeen Immigration Solutions — Privacy Policy
          </h1>
          <p className="text-sm text-slate-500">Last updated: 26 August 2026</p>
          <p className="text-base leading-7 text-slate-600">
            Tashfeen Immigration Solutions (&ldquo;we&rdquo;, &ldquo;us&rdquo;) provides immigration
            consultancy services. This policy explains how we collect, use, and protect your personal
            data when you contact us through Facebook Messenger, WhatsApp, Instagram, our website, or
            our advertisements.
          </p>
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">1. Information we collect</h2>
            <p className="text-sm leading-6 text-slate-600">
              When you message us through Facebook Messenger, WhatsApp, or Instagram, we receive your
              name, the public profile information you choose to share, and the content of your
              messages. When you contact us by phone, forms, or our website, we collect the details
              you provide — such as your name, contact number, email, and the immigration service or
              destination country you are interested in. We also keep a record of our communications
              with you and any documents you send us for your case.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">2. How we use your data</h2>
            <p className="text-sm leading-6 text-slate-600">
              We use your information solely to respond to your enquiry, assess your immigration
              options, deliver our consultancy services, schedule consultations, manage your case,
              and follow up with you. We do <strong>not</strong> sell your data or use it for
              third-party advertising.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">3. Third-party services (Meta)</h2>
            <p className="text-sm leading-6 text-slate-600">
              We use Meta Platforms — Facebook, Messenger, WhatsApp, and Instagram — to receive and
              reply to your messages, subject to Meta&rsquo;s terms and policies. We also use trusted
              service providers for secure hosting and email. These providers process data only on
              our behalf and are required to protect it. We do not transfer your personal data to
              unrelated third parties.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">4. Data storage &amp; security</h2>
            <p className="text-sm leading-6 text-slate-600">
              Your messages and details are stored securely in our internal customer-management
              system, accessible only to authorised staff. We apply administrative, technical, and
              physical safeguards, restrict access, and encrypt sensitive credentials. We retain your
              data only as long as necessary to serve you and to meet our legal obligations.
            </p>
          </div>

          <div id="data-deletion" className="space-y-3 scroll-mt-24">
            <h2 className="text-xl font-semibold text-slate-900">5. Data deletion &amp; your choices</h2>
            <p className="text-sm leading-6 text-slate-600">
              You may request access to, correction of, or deletion of your personal data at any
              time by emailing{' '}
              <a className="font-medium text-blue-600 underline" href="mailto:admin@tashfeengroup.com">
                admin@tashfeengroup.com
              </a>
              . We will delete your personal data from our systems within 30 days of your request,
              except where we are legally required to retain it. To remove data associated with your
              Facebook/Messenger, WhatsApp, or Instagram messages, simply include the name or number
              you used to contact us.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">6. Contact us</h2>
            <p className="text-sm leading-6 text-slate-600">
              Tashfeen Immigration Solutions — Islamabad &amp; Lahore, Pakistan.
              <br />
              Email:{' '}
              <a className="font-medium text-blue-600 underline" href="mailto:admin@tashfeengroup.com">
                admin@tashfeengroup.com
              </a>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
