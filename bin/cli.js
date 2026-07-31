#!/usr/bin/env node
import { adapters } from '../src/adapters/index.js';
import { loadSkills } from '../src/skills.js';
import { detectAgents, installedSkills, sync, uninstall } from '../src/install.js';
import { pkg } from '../src/config.js';

const c = process.stdout.isTTY
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m` }
  : { dim: (s) => s, bold: (s) => s, green: (s) => s, yellow: (s) => s, red: (s) => s };

const HELP = `${c.bold(pkg.name)} v${pkg.version} — ${pkg.description}

Usage
  ali-agent-kit install            install/update skills into every detected agent
  ali-agent-kit update             alias of install
  ali-agent-kit list               show source skills and what is installed
  ali-agent-kit uninstall          remove every skill this package installed
  ali-agent-kit agents             show detected agents

Options
  --agent <id>     limit to one agent (repeatable). Known: ${adapters.map((a) => a.id).join(', ')}
  --dry-run        print what would change, write nothing
  --no-prune       keep skills that were deleted from the package
  -h, --help       this text
  -v, --version    print version
`;

function parseArgs(argv) {
  const opts = { command: null, agents: [], dryRun: false, prune: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--agent') opts.agents.push(argv[++i]);
    else if (arg.startsWith('--agent=')) opts.agents.push(arg.slice(8));
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-prune') opts.prune = false;
    else if (arg === '-h' || arg === '--help') opts.command = 'help';
    else if (arg === '-v' || arg === '--version') opts.command = 'version';
    else if (!arg.startsWith('-') && !opts.command) opts.command = arg;
    else fail(`Unknown option: ${arg}`);
  }
  return opts;
}

function fail(message) {
  console.error(c.red(message));
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));
const only = opts.agents.length ? opts.agents : null;

for (const id of opts.agents) {
  if (!adapters.some((a) => a.id === id)) {
    fail(`Unknown agent: ${id}. Known: ${adapters.map((a) => a.id).join(', ')}`);
  }
}

switch (opts.command ?? 'help') {
  case 'install':
  case 'update':
  case 'sync':
    runSync();
    break;
  case 'uninstall':
  case 'remove':
    runUninstall();
    break;
  case 'list':
    runList();
    break;
  case 'agents':
    runAgents();
    break;
  case 'version':
    console.log(pkg.version);
    break;
  case 'help':
    console.log(HELP);
    break;
  default:
    fail(`Unknown command: ${opts.command}\n\n${HELP}`);
}

function runSync() {
  const skills = loadSkills();
  if (!skills.length) fail('No skills found in the package.');

  const result = sync({ skills, only, dryRun: opts.dryRun, prune: opts.prune });

  if (!result.agents.length) {
    console.log(c.yellow('No supported agent found. Nothing to do.'));
    printSkipped(result.skipped);
    return;
  }

  const label = opts.dryRun ? c.dim(' (dry run)') : '';
  for (const agent of result.agents) {
    console.log(`\n${c.bold(agent.adapter.label)}${label} ${c.dim(agent.skillsDir)}`);
    for (const name of agent.added) console.log(`  ${c.green('+')} ${name}`);
    for (const name of agent.updated) console.log(`  ${c.dim('~')} ${name}`);
    for (const name of agent.removed) console.log(`  ${c.red('-')} ${name} ${c.dim('(removed from package)')}`);
    for (const name of agent.conflicts) {
      console.log(`  ${c.yellow('!')} ${name} ${c.dim('exists and is not managed by this package — skipped')}`);
    }
  }
  printSkipped(result.skipped);
  console.log(`\n${c.green('Done.')} ${result.skills.length} skill(s).`);
}

function runUninstall() {
  const result = uninstall({ only, dryRun: opts.dryRun });
  for (const agent of result.agents) {
    console.log(`\n${c.bold(agent.adapter.label)} ${c.dim(agent.skillsDir)}`);
    if (!agent.removed.length) console.log(c.dim('  nothing installed'));
    for (const name of agent.removed) console.log(`  ${c.red('-')} ${name}`);
  }
}

function runList() {
  const skills = loadSkills();
  console.log(c.bold('\nSkills in package'));
  for (const skill of skills) {
    console.log(`  ${skill.name} ${c.dim(`(${skill.sourceName}) — ${skill.description || 'no description'}`)}`);
  }
  for (const agent of detectAgents({ only }).filter((a) => a.present)) {
    const installed = installedSkills(agent.skillsDir);
    console.log(`\n${c.bold(agent.adapter.label)} ${c.dim(agent.skillsDir)}`);
    if (!installed.length) console.log(c.dim('  nothing installed'));
    for (const name of installed) console.log(`  ${name}`);
  }
}

function runAgents() {
  for (const agent of detectAgents({ only })) {
    const mark = agent.present ? c.green('detected') : c.dim('not found');
    console.log(`${agent.adapter.id.padEnd(10)} ${mark} ${c.dim(agent.configDir)}`);
  }
}

function printSkipped(skipped) {
  for (const agent of skipped) {
    console.log(c.dim(`\n${agent.adapter.label}: not installed (${agent.configDir}) — skipped`));
  }
}
