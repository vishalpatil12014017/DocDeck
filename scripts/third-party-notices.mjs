// Writes ThirdPartyNotices.txt: the license text of every production dependency bundled into the extension.
// The bundle is minified, so this file is how DocDeck ships the copyright/license notices these licenses require.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dirs = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .slice(1); // first line is the project itself

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;
const seen = new Map();

for (const dir of dirs) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const id = `${pkg.name}@${pkg.version}`;
  if (seen.has(id)) continue;
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? pkg.licenses?.map((l) => l.type ?? l).join(' OR ') ?? 'see package';
  const texts = readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').trim());
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  seen.set(id, { name: pkg.name, version: pkg.version, license, repo, texts });
}

const entries = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const header = `DocDeck — third-party software notices

DocDeck bundles the open-source packages listed below. Each is distributed under its own license,
reproduced here. Where a package offers a choice of licenses (for example "MIT OR GPL-3.0"), DocDeck
uses it under the first, permissive option.

elkjs is licensed under the Eclipse Public License 2.0 and is included unmodified as part of Mermaid's
optional ELK diagram layout. Its source code is available at https://github.com/kieler/elkjs and from
the npm package "elkjs".

${entries.length} packages.
`;

const body = entries
  .map((e) => {
    const lines = [`${'='.repeat(78)}`, `${e.name} ${e.version}`, `License: ${e.license}`];
    if (e.repo) lines.push(`Source: ${e.repo.replace(/^git\+/, '')}`);
    lines.push('', e.texts.length ? e.texts.join('\n\n') : `(No license file in the package; licensed under ${e.license}.)`);
    return lines.join('\n');
  })
  .join('\n\n');

writeFileSync(join(root, 'ThirdPartyNotices.txt'), `${header}\n${body}\n`);
console.log(`ThirdPartyNotices.txt: ${entries.length} packages, ${entries.filter((e) => !e.texts.length).length} without a license file`);
