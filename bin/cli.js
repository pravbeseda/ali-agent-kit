#!/usr/bin/env node
import { adapters, resolveAdapters } from '../src/adapters/index.js';
import { loadSkills, SkillError } from '../src/skills.js';
import { detectAgents, installedSkills, sync, uninstall } from '../src/install.js';
import { pkg } from '../src/config.js';

const c = process.stdout.isTTY
  ? { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m` }
  : { dim: (s) => s, bold: (s) => s, green: (s) => s, yellow: (s) => s, red: (s) => s };

const AGENT_NAMES = adapters
  .map((a) => [a.id, ...(a.aliases ?? [])].join(' | '))
  .concat('all')
  .join(', ');

const HELP = `${c.bold(pkg.name)} v${pkg.version} — ${pkg.description}

Usage
  ali-agent-kit install            install/update skills into every detected agent
  ali-agent-kit update             alias of install
  ali-agent-kit validate           check the skills in this package, write nothing
  ali-agent-kit list               show source skills and what is installed
  ali-agent-kit uninstall          remove every skill this package installed
  ali-agent-kit agents             show detected agents

Options
  --agent <id[,id]>  limit to these agents (repeatable). Values: ${AGENT_NAMES}
  --dry-run          print what would change, write nothing
  --no-prune         keep skills that were deleted from the package
  -h, --help         this text
  -v, --version      print version

Exit codes: 0 ok, 1 error, 2 finished with conflicts (unmanaged paths left alone)
`;

function parseArgs(argv) {
  const opts = { command: null, agents: [], dryRun: false, prune: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const pushAgents = (value) => {
      if (!value || value.startsWith('-')) fail('--agent requires a value');
      opts.agents.push(...value.split(',').filter(Boolean));
    };

    if (arg === '--agent') pushAgents(argv[++i]);
    else if (arg.startsWith('--agent=')) pushAgents(arg.slice('--agent='.length));
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-prune') opts.prune = false;
    else if (arg === '-h' || arg === '--help') opts.command = 'help';
    else if (arg === '-v' || arg === '--version') opts.command = 'version';
    else if (arg.startsWith('-')) fail(`Unknown option: ${arg}`);
    else if (!opts.command) opts.command = arg;
    else fail(`Unexpected argument: ${arg}`);
  }
  return opts;
}

function fail(message) {
  console.error(c.red(message));
  process.exit(1);
}

const opts = parseArgs(process.argv.slice(2));
let only = null;
try {
  if (opts.agents.length) {
    resolveAdapters(opts.agents); // validates ids/aliases up front
    only = opts.agents;
  }
} catch (error) {
  fail(error.message);
}

try {
  run(opts.command ?? 'help');
} catch (error) {
  fail(error instanceof SkillError ? `Invalid skill: ${error.message}` : error.stack ?? error.message);
}

function run(command) {
  switch (command) {
    case 'install':
    case 'update':
    case 'sync':
      return runSync();
    case 'uninstall':
    case 'remove':
      return runUninstall();
    case 'validate':
      return runValidate();
    case 'list':
      return runList();
    case 'agents':
      return runAgents();
    case 'version':
      return console.log(pkg.version);
    case 'help':
      return console.log(HELP);
    default:
      fail(`Unknown command: ${command}\n\n${HELP}`);
  }
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
    for (const name of agent.restored) {
      console.log(`  ${c.yellow('↻')} ${name} ${c.dim('(restored after an interrupted run)')}`);
    }
    for (const name of agent.added) console.log(`  ${c.green('+')} ${name}`);
    for (const name of agent.updated) console.log(`  ${c.dim('~')} ${name}`);
    for (const name of agent.removed) console.log(`  ${c.red('-')} ${name} ${c.dim('(removed from package)')}`);
    for (const conflict of agent.conflicts) {
      console.log(`  ${c.yellow('!')} ${conflict.path} ${c.dim(`${conflict.reason} — left untouched`)}`);
    }
  }
  printSkipped(result.skipped);

  if (result.conflicts.length) {
    console.log(`\n${c.yellow(`Finished with ${result.conflicts.length} conflict(s).`)}`);
    process.exit(2);
  }
  console.log(`\n${c.green('Done.')} ${result.skills.length} skill(s).`);
}

function runUninstall() {
  const result = uninstall({ only, dryRun: opts.dryRun });
  for (const agent of result.agents) {
    console.log(`\n${c.bold(agent.adapter.label)} ${c.dim(agent.skillsDir)}`);
    if (!agent.removed.length) console.log(c.dim('  nothing installed'));
    for (const name of agent.removed) console.log(`  ${c.red('-')} ${name}`);
  }
  printSkipped(result.skipped);
}

function runValidate() {
  const skills = loadSkills();
  if (!skills.length) fail('No skills found in the package.');
  console.log(c.green(`${skills.length} skill(s) valid:`));
  for (const skill of skills) console.log(`  ${skill.name} ${c.dim(`(${skill.sourceName})`)}`);
}

function runList() {
  const skills = loadSkills();
  console.log(c.bold('\nSkills in package'));
  for (const skill of skills) {
    console.log(`  ${skill.name} ${c.dim(`(${skill.sourceName}) — ${skill.description}`)}`);
  }
  const { detected, skipped } = detectAgents({ only });
  for (const target of detected) {
    const installed = installedSkills(target.skillsDir);
    console.log(`\n${c.bold(target.adapter.label)} ${c.dim(target.skillsDir)}`);
    if (!installed.length) console.log(c.dim('  nothing installed'));
    for (const name of installed) console.log(`  ${name}`);
  }
  printSkipped(skipped);
}

function runAgents() {
  const { detected, skipped } = detectAgents({ only });
  for (const target of detected) {
    console.log(`${target.adapter.id.padEnd(12)} ${c.green('detected')}   ${c.dim(target.skillsDir)}`);
  }
  for (const agent of skipped) {
    const where = (agent.configDirs ?? [agent.configDir]).join(', ');
    console.log(`${agent.adapter.id.padEnd(12)} ${c.dim('not found')}  ${c.dim(where)}`);
  }
}

function printSkipped(skipped) {
  for (const agent of skipped) {
    const where = (agent.configDirs ?? [agent.configDir]).join(', ');
    console.log(c.dim(`\n${agent.adapter.label}: not installed (${where}) — skipped`));
  }
}
