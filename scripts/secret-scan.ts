import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface Finding {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

interface Rule {
  name: string;
  pattern: RegExp;
  skip?: (line: string) => boolean;
}

const listCandidateFiles = (): { files: string[]; mode: 'git' | 'fallback' } => {
  try {
    return {
      mode: 'git',
      files: execSync('git ls-files', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    };
  } catch {
    try {
      return {
        mode: 'fallback',
        files: execSync('rg --files --hidden -g !node_modules -g !dist -g !external-repos -g !.git', {
          encoding: 'utf8',
        })
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
      };
    } catch {
      return {
        mode: 'fallback',
        files: execSync('find . -type f', { encoding: 'utf8' })
          .split('\n')
          .map((value) => value.trim().replace(/^\.\//, ''))
          .filter(Boolean)
          .filter(
            (file) =>
              !file.includes('/node_modules/') &&
              !file.includes('/dist/') &&
              !file.startsWith('external-repos/') &&
              !file.startsWith('.git/'),
          ),
      };
    }
  }
};

const listedFiles = listCandidateFiles();
const trackedFiles = listedFiles.files.filter((file) => !file.startsWith('external-repos/'));

const rules: Rule[] = [
  {
    name: 'Private key block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    name: 'GitHub token',
    pattern: /\bghp_[A-Za-z0-9]{36}\b/,
  },
  {
    name: 'Slack token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    name: 'AWS access key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    name: 'Potential hardcoded credential assignment',
    pattern:
      /\b(?:API_KEY|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY|AUTH_TOKEN|BEARER_TOKEN)\b\s*[:=]\s*['"]?[A-Za-z0-9_+/\-=]{20,}/i,
    skip: (line: string) =>
      /replace-with|example|placeholder|your-|dummy|changeme|localhost|dev-api-key/i.test(line),
  },
  {
    name: 'Potential Solana PRIVATE_KEY assignment',
    pattern: /\bPRIVATE_KEY\s*=\s*[1-9A-HJ-NP-Za-km-z]{64,}\b/,
    skip: (line: string) => /example|placeholder|replace-with/i.test(line),
  },
];

const binaryExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.pdf',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.zip',
  '.gz',
  '.tar',
]);

const findings: Finding[] = [];

for (const file of trackedFiles) {
  const ext = path.extname(file).toLowerCase();
  if (binaryExtensions.has(ext)) {
    continue;
  }
  if (file === '.env') {
    if (listedFiles.mode === 'git') {
      findings.push({
        file,
        line: 1,
        rule: '.env file committed',
        snippet: '.env should remain untracked',
      });
    }
    continue;
  }
  if (file.endsWith('.env.example')) {
    continue;
  }
  if (file.endsWith('.md')) {
    continue;
  }

  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  if (content.includes('\u0000')) {
    continue;
  }

  const lines = content.split('\n');
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (!rule.pattern.test(line)) {
        continue;
      }
      if (rule.skip?.(line)) {
        continue;
      }
      findings.push({
        file,
        line: index + 1,
        rule: rule.name,
        snippet: line.trim().slice(0, 180),
      });
    }
  });
}

if (findings.length > 0) {
  console.error(`Secret scan failed with ${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.rule}] ${finding.snippet}`);
  }
  process.exit(1);
}

console.log(`Secret scan passed. Checked ${trackedFiles.length} tracked files.`);
