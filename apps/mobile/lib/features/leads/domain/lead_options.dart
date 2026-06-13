// Canonical option lists for the lead form, mirrored from the web portal so
// the app classifies leads with the exact same values:
//   - service types  ← apps/frontend/lib/service-types.ts (stored as `code`)
//   - target country ← apps/frontend/lib/countries.ts (stored as the name)

/// A service a lead can be classified as. `code` is persisted in
/// `Lead.serviceInterest`; `label` is shown in the UI.
class ServiceTypeOption {
  final String code;
  final String label;
  const ServiceTypeOption(this.code, this.label);
}

const List<ServiceTypeOption> kServiceTypes = [
  ServiceTypeOption('STUDY_VISA', 'Study Visa'),
  ServiceTypeOption('WORK_PERMIT', 'Work Permit (WP)'),
  ServiceTypeOption('PR_CASE', 'Permanent Residency (PR)'),
  ServiceTypeOption('VISIT_VISA', 'Visit Visa'),
  ServiceTypeOption('TOURIST_VISA', 'Tourist Visa'),
  ServiceTypeOption('SPOUSE_VISA', 'Spouse Visa'),
  ServiceTypeOption('E2_VISA', 'E2 Visa'),
  ServiceTypeOption('CBI', 'Citizenship by Investment'),
  ServiceTypeOption('JR_RESUBMISSION', 'JR Resubmission'),
];

/// Map a stored value to its label. Returns the raw value for legacy free-text
/// leads (so they keep rendering), and '' for empty/null.
String serviceTypeLabel(String? code) {
  if (code == null || code.trim().isEmpty) return '';
  for (final s in kServiceTypes) {
    if (s.code == code) return s.label;
  }
  return code;
}

/// True if the value is one of our canonical codes (vs. legacy free text).
bool isCanonicalServiceCode(String? code) =>
    code != null && kServiceTypes.any((s) => s.code == code);

/// Destinations Tashfeen sees most — surfaced as quick-pick chips.
const List<String> kPopularCountries = [
  'Canada',
  'Australia',
  'United Kingdom',
  'United States',
  'Germany',
  'Saudi Arabia',
  'United Arab Emirates',
  'Turkey',
];

/// Alphabetical list of (essentially) every country a lead might target.
/// Stored as the plain display name to match Lead.targetCountry.
const List<String> kAllCountries = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda',
  'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas',
  'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin',
  'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
  'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada',
  'Cape Verde', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia',
  'Comoros', 'Congo (Brazzaville)', 'Congo (Kinshasa)', 'Costa Rica', 'Croatia',
  'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Djibouti', 'Dominica',
  'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea',
  'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada',
  'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras',
  'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq',
  'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan',
  'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos',
  'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein',
  'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malawi', 'Malaysia',
  'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius',
  'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro',
  'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal',
  'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea',
  'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine',
  'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland',
  'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis',
  'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino',
  'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles',
  'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands',
  'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka',
  'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan',
  'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago',
  'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay',
  'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen',
  'Zambia', 'Zimbabwe',
];
