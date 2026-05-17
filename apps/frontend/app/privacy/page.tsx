import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Tafsheen',
  description: 'Privacy policy for Tashfeen Immigration Solutions AI Platform.',
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
            Tashfeen Privacy Policy
          </h1>
          <p className="text-base leading-7 text-slate-600">
            This privacy policy explains how Tashfeen Immigration Solutions collects,
            uses, and protects personal data when you use our platform.
          </p>
        </section>

        <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">1. Information we collect</h2>
            <p className="text-sm leading-6 text-slate-600">
              We collect information necessary to deliver services, including contact details,
              case and immigration data, communication history, and support requests.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">2. How we use data</h2>
            <p className="text-sm leading-6 text-slate-600">
              Data is used to manage leads, clients, cases, appointments, documents, and
              communications. We also use data to operate the platform securely and improve
              its functionality.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">3. Third-party services</h2>
            <p className="text-sm leading-6 text-slate-600">
              We may use third-party services such as hosting providers, email, analytics,
              payment processors, and messaging integrations. These providers process data on
              our behalf and are required to protect it in accordance with this policy.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">4. Data security</h2>
            <p className="text-sm leading-6 text-slate-600">
              We implement administrative, technical, and physical safeguards to protect
              personal information. Access is restricted, and sensitive credentials are
              encrypted where required.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">5. Your choices</h2>
            <p className="text-sm leading-6 text-slate-600">
              You can request updates, corrections, or removal of your personal information
              by contacting your service provider or administrator. We retain data only as
              long as necessary for legitimate business purposes.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-slate-900">6. Contact</h2>
            <p className="text-sm leading-6 text-slate-600">
              If you have questions about this privacy policy, please contact the platform
              administrator or the person who provided access to Tafsheen Immigration
              Solutions.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
