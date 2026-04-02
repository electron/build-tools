// @ts-expect-error — no types published for this package.
import chrome from '@marshallofsound/chrome-cookies-secure';

const BASE_URL = 'https://issues.chromium.org';

/** Extract a delimited slice from a larger string. Exported for testing. */
export function getPayload(html: string, start: string, end: string): string {
  return html.substring(html.indexOf(start) + start.length, html.indexOf(end));
}

async function getXsrfToken(osid: string): Promise<string | null> {
  const html = await fetch(`${BASE_URL}/issues`, {
    headers: {
      Cookie: `OSID=${osid}`,
      'Content-Type': 'application/json',
    },
  }).then((r) => r.text());

  const DATA_START = 'var buganizerSessionJspb = ';
  const DATA_END = '; var defrostedResourcesJspb';

  const payload = getPayload(html, DATA_START, DATA_END);
  const parsed = JSON.parse(payload) as unknown[];

  // There won't be a valid xsrf token for unsigned-in users.
  const session = parsed[0] as unknown[];
  if (session[4] === 'ANONYMOUS') {
    return null;
  }

  return parsed[2] as string;
}

type IssueData = unknown[];

async function getBugInfo(bugNr: string): Promise<IssueData> {
  const profile = process.env['CHROME_SECURITY_PROFILE'] ?? 'Profile 1';
  const cookies: Record<string, string> = await chrome.getCookiesPromised(
    BASE_URL,
    'object',
    profile,
  );
  const OSID = cookies['OSID'];
  if (!OSID) throw new Error('No OSID cookie found');

  const xsrfToken = await getXsrfToken(OSID);

  // Endpoint found via the included buganizer js file in script tag of BASE_URL.
  const result = await fetch(`${BASE_URL}/action/issues/${bugNr}`, {
    headers: {
      Accept: '*/*',
      Cookie: `OSID=${OSID}`,
      'x-xsrf-token': xsrfToken ?? '',
    },
    method: 'GET',
  })
    .then((r) => r.text())
    .then((rawJSON) => {
      // This API call can sometimes return errant invalid characters at the start of the response.
      let cleaned: string;
      if (rawJSON.indexOf('[') > -1) {
        cleaned = rawJSON.substring(rawJSON.indexOf('['), rawJSON.length);
      } else if (rawJSON.indexOf('{') > -1) {
        cleaned = rawJSON.substring(rawJSON.indexOf('{'), rawJSON.length);
      } else {
        throw new Error(`Unxpected payload received for issue ${bugNr}`);
      }

      return JSON.parse(cleaned) as IssueData;
    });

  const maybeMessage = (result as { message?: string }).message;
  if (maybeMessage && /IamPermissionDeniedException/.test(maybeMessage)) {
    throw new Error(`Requested access to issue with insufficient permissions ${bugNr}`);
  }

  return result;
}

/** Traverse the issue payload to extract the CVE identifier. Exported for testing. */
export function parseCveFromIssue(issue: IssueData): string | null {
  const CVE_ID = 1223136;

  // The shape here mirrors the buganizer JSPB payload; indices are stable.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const issueData = (issue as any)[0][1] as any[];
  const issueMetaData = issueData[issueData.length - 1];
  const cveData = (issueMetaData[2][14] as any[]).find((d: any[]) => d[0] === CVE_ID);
  const cve = cveData[cveData.length - 2] as string;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return /\d{4}-\d{4,7}/.test(cve) ? `CVE-${cve}` : null;
}

export async function getCveForBugNr(bugNr: string): Promise<string | null> {
  if (Number.isNaN(Number(bugNr))) {
    throw new Error(`Invalid Chromium bug number ${bugNr}`);
  }

  try {
    const issue = await getBugInfo(bugNr);
    return parseCveFromIssue(issue);
  } catch (error) {
    throw new Error(`Failed to fetch CVE for ${bugNr} - ${String(error)}`);
  }
}
