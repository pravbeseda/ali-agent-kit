/**
 * Runs every test changed on the current branch headless, repeated `--burn` times,
 * and saves a screenshot of the `(Results)` box of each run.
 */
import { execFileSync, spawn } from "child_process";
import fs from "fs";
import http from "http";
import minimist from "minimist";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { generateCypressConfig, getCypressConfig, getWebServerConfigs, patchCsp } from "./configs.mjs";
import { waitServerIsReady, yarn } from "./utils.mjs";

const TEST_DECLARATION = /(^|[\s;{}])(it|specify)(\.only|\.skip)?\s*\(/g;
const FALLBACK_BASE = "origin/develop";
const ANSI = /\u001b\[[0-9;]*m/g;
const CHROMIUM_LOG = /^\s*\[\d+:\d+\/\d+\.\d+:(ERROR|WARNING|INFO|VERBOSE)/;

const cypressDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(cypressDir);

const argv = minimist(process.argv.slice(2), {
    string: ["base", "app", "out", "only"],
    boolean: ["dry-run", "all", "help"],
    default: { app: "uc:default", burn: 20, retries: 0 },
});

if (argv.help) {
    console.log(usage());
    process.exit(0);
}

// a bare call runs on the defaults, which is fine — but show what could have been asked for
if (process.argv.length === 2) {
    console.log(usage());
}

const [app, branding = "default"] = String(argv.app).split(":");
const burn = Number(argv.burn);
const retries = Number(argv.retries);
const repoRoot = git(["rev-parse", "--show-toplevel"]);
const base = resolveBase();
console.log(`\nBase: ${base.ref} (${base.source})`);

if (!git(["rev-parse", "--verify", "--quiet", `${base.ref}^{commit}`], { allowFailure: true })) {
    console.error(`! "${base.ref}" is no commit of this clone. Fetch it, or name another base with --base.`);
    process.exit(1);
}

const outDir = path.resolve(argv.out ?? path.join("results", "burn", stamp()));

const only = [argv.only ?? []].flat();
const changed = collectChangedTests();
const runs = only.length === 0 ? changed : changed.filter(run => only.some(text => run.title.includes(text)));

if (runs.length === 0) {
    console.log(
        only.length > 0 && changed.length > 0
            ? `None of the ${changed.length} changed test(s) has ${only.map(text => `"${text}"`).join(" or ")} in its title.`
            : `No changed cypress test found against "${base.ref}". Nothing to burn.`,
    );
    process.exit(0);
}

console.log(`\nChanged tests to burn ${burn} times each (${app}:${branding}, retries=${retries}):`);
runs.forEach((run, index) => console.log(`  ${index + 1}. ${path.basename(run.spec)} › ${run.title}`));

const unmatchable = runs.filter(run => isUnmatchable(run.title));
if (unmatchable.length > 0) {
    console.warn(
        `\n! ${unmatchable.length} of them cannot be matched by cypress-grep and will come back as a test that ` +
            `never ran — a ";" in a title separates two greps, a leading "-" inverts the match, and a title built ` +
            `from a template literal is not the title at runtime:\n` +
            unmatchable.map(run => `    ${run.title}`).join("\n"),
    );
}

if (argv["dry-run"]) {
    process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });

const configPath = `${cypressDir}/configs/integration.generated.ts`;
await generateCypressConfig(app, branding, configPath);

const startedServers = await startMissingWebServers();
const chromeProfiles = [];
const results = [];

try {
    for (const [index, run] of runs.entries()) {
        console.log(`\n=== [${index + 1}/${runs.length}] ${run.title} ===\n`);
        results.push(await burnTest(run, index + 1));
    }
} finally {
    startedServers.forEach(child => child.kill());
    chromeProfiles.forEach(profile => {
        // a temp directory that refuses to go — a chrome child still holding it, which is what
        // windows tends to do — must not take the run down with it
        try {
            fs.rmSync(profile, { force: true, recursive: true, maxRetries: 10, retryDelay: 200 });
        } catch {
            // left for the operating system to clean up
        }
    });
}

await reportSummary();

function collectChangedTests() {
    const mergeBase = git(["merge-base", base.ref, "HEAD"], { allowFailure: true }) || base.ref;
    const diff = git(["diff", "--unified=0", "--no-color", mergeBase, "--", "testing/Cypress/*.spec.ts"], {
        cwd: repoRoot,
    });
    const untracked = git(["ls-files", "--others", "--exclude-standard", "--", "testing/Cypress/*.spec.ts"], {
        cwd: repoRoot,
    })
        .split("\n")
        .filter(Boolean);

    const changed = changedLinesByFile(diff);
    untracked.forEach(file => (changed[file] = "whole-file"));

    return Object.entries(changed).flatMap(([file, changedLines]) => {
        const absolute = path.join(repoRoot, file);
        if (!fs.existsSync(absolute)) {
            return [];
        }

        const tests = findTests(fs.readFileSync(absolute, "utf-8"));
        const spec = `./${path.relative(cypressDir, absolute).split(path.sep).join("/")}`;

        if (changedLines === "whole-file" || argv.all) {
            return burnable(file, tests).map(test => ({ spec, title: test.title }));
        }

        const selection = selectChangedTests(tests, changedLines);
        if (selection.linesOutsideTests.length > 0 && selection.tests.length < tests.length) {
            console.warn(
                `! ${file}: ${selection.linesOutsideTests.length} changed line(s) outside any test ` +
                    `(line ${selection.linesOutsideTests[0]}, …). They are shared by the whole spec — pass --all to burn every test of it.`,
            );
        }

        return burnable(file, selection.tests).map(test => ({ spec, title: test.title }));
    });
}

// an `it.skip` is switched off on purpose: cypress-grep leaves it pending, so burning it would
// come back as a test that never ran. It is dropped from the selection instead
function burnable(file, tests) {
    const skipped = tests.filter(test => test.skipped);
    if (skipped.length > 0) {
        console.warn(`! ${file}: ${skipped.length} changed test(s) are it.skip and are not burned.`);
    }

    return tests.filter(test => !test.skipped);
}

async function burnTest(run, position) {
    const output = await runCypress(run);
    const resultsBlock = extractResultsBlock(output);
    const name = `${String(position).padStart(2, "0")}-${slug(run.title)}`;

    if (!resultsBlock) {
        console.error(`! The run of "${run.title}" produced no (Results) box — see the output above.`);
        fs.writeFileSync(path.join(outDir, `${name}.log`), output);
        return { ...run, resultsBlock: undefined };
    }

    const counts = countsOf(resultsBlock);
    const runsMade = counts.passing + counts.failing;
    if (runsMade !== burn) {
        console.warn(
            runsMade === 0
                ? `! "${run.title}" never ran — no test of ${path.basename(run.spec)} matched the title, ` +
                      `or the suite holding it is switched off with describe.skip.`
                : `! "${run.title}" ran ${runsMade} times instead of ${burn} — the title matches more than one test. ` +
                      `Burn them one at a time with --only "<a longer part of the title>".`,
        );
    }

    const caption = `it: ${run.title}  ×${burn}`;
    const screenshot = path.join(outDir, `${name}.png`);
    const rendered = await renderScreenshot(`${caption}\n${resultsBlock}`, screenshot);

    return { ...run, resultsBlock, screenshot: rendered ? screenshot : undefined, counts };
}

function runCypress(run) {
    const args = [
        "cypress",
        "run",
        "--project",
        ".",
        "-C",
        configPath,
        "--spec",
        run.spec,
        "--config",
        `retries=${retries}`,
        // grepOmitFiltered keeps the other tests of the spec out of the run and out of the
        // (Results) box, so the table holds the burned runs of this one test and nothing else.
        // It has to travel as --env: a CYPRESS_grepOmitFiltered variable does not reach cypress-grep.
        "--env",
        "grepOmitFiltered=true",
    ];

    return new Promise((resolve, reject) => {
        const child = spawn(yarn(), args, {
            shell: true,
            env: { ...process.env, CYPRESS_grep: run.title, CYPRESS_burn: String(burn) },
        });

        let output = "";
        let unprinted = "";
        const collect = data => {
            output += data.toString();

            // the browsers cypress launches log their own noise, eg. an ERROR line about
            // SetApplicationIsDaemon. It is dropped from the console, not from `output`
            const lines = (unprinted + data.toString()).split("\n");
            unprinted = lines.pop();
            const worthPrinting = lines.filter(line => !CHROMIUM_LOG.test(line));
            if (worthPrinting.length > 0) {
                process.stdout.write(`${worthPrinting.join("\n")}\n`);
            }
        };

        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        child.on("error", reject);
        child.on("close", () => {
            process.stdout.write(unprinted);
            resolve(output);
        });
    });
}

async function startMissingWebServers() {
    const webServers = await getWebServerConfigs(app, branding);
    const missing = [];

    for (const webServer of webServers) {
        if (await isServerUp(webServer.url)) {
            console.log(`WebServer already running, reusing it: ${webServer.url}`);
            continue;
        }
        missing.push(webServer);
    }

    if (missing.length === 0) {
        return [];
    }

    await patchCsp(app, branding);

    const started = missing.map(webServer => {
        const dist = path.resolve(cypressDir, "../..", webServer.distPath);
        if (!fs.existsSync(dist)) {
            throw new Error(
                `No build to serve at "${dist}". Run "yarn build:desktop:dev" (or "yarn start:web") first.`,
            );
        }

        const port = webServer.url.split(":")[2];
        console.log(`Starting webserver ${webServer.url} from ${webServer.distPath}`);

        // spawned quietly: the webserver has nothing to say that belongs in the burn output
        return spawn(yarn(), ["sirv", `../../${webServer.distPath}`, "-m", "0", "--port", port, "-s", "-q"], {
            shell: true,
            stdio: "ignore",
        });
    });

    try {
        await Promise.all(missing.map(webServer => waitServerIsReady(webServer.url)));
    } catch (error) {
        started.forEach(child => child.kill());
        throw error;
    }

    return started;
}

function isServerUp(url) {
    return new Promise(resolve => {
        const request = http.get(url, response => resolve(response.statusCode === 200));
        request.on("error", () => resolve(false));
        request.setTimeout(2000, () => {
            request.destroy();
            resolve(false);
        });
    });
}

async function renderScreenshot(text, target) {
    const chrome = findChrome();
    if (!chrome) {
        console.warn("! No Chrome found — no screenshot was made.");
        return false;
    }

    const lines = text.split("\n");
    // the page is a monospace block: the window is sized from the character metrics, with a little
    // slack so the borders of the box are not clipped
    const width = Math.ceil(Math.max(...lines.map(line => line.length)) * 8.45) + 64;
    const height = lines.length * 20 + 64;
    const page = path.join(os.tmpdir(), `burn-${path.basename(target, ".png")}.html`);

    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "burn-chrome-"));
    fs.writeFileSync(page, renderHtml(text));

    // Headless chrome writes the screenshot and then keeps running, so it is stopped by hand
    // as soon as the file has stopped growing.
    const chromeProcess = spawn(
        chrome,
        [
            "--headless",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            "--log-level=3",
            "--force-device-scale-factor=2",
            `--user-data-dir=${profile}`,
            `--window-size=${width},${height}`,
            `--screenshot=${target}`,
            pathToFileURL(page).href,
        ],
        { stdio: "ignore" },
    );

    try {
        await waitForFile(target, 30000);
    } finally {
        chromeProcess.kill("SIGKILL");
        fs.rmSync(page, { force: true });
        // a killed chrome keeps flushing its profile for a moment, which makes removing the
        // directory right here fail with ENOTEMPTY — it is dropped once the whole run is over
        chromeProfiles.push(profile);
    }

    if (!fs.existsSync(target)) {
        console.warn(`! Chrome did not produce ${path.basename(target)}.`);
        return false;
    }

    return true;
}

async function waitForFile(target, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;

    while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));

        const size = fs.existsSync(target) ? fs.statSync(target).size : -1;
        if (size > 0 && size === lastSize) {
            return;
        }
        lastSize = size;
    }
}

function renderHtml(text) {
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: #16161a; }
    pre { margin: 0; padding: 24px; color: #e8e8ea; white-space: pre;
          font: 14px/20px Menlo, "SF Mono", Consolas, monospace; }
</style></head>
<body><pre>${escapeHtml(text)}</pre></body></html>`;
}

function findChrome() {
    const windows = [
        `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ];
    const mac = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
    const candidates = [process.env.CHROME_PATH, ...(process.platform === "win32" ? windows : mac)];

    return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

async function reportSummary() {
    console.log(`\nBurn summary (${burn} runs per test):\n`);

    results.forEach(result => {
        const counts = result.counts;
        const verdict = counts
            ? `${counts.passing} of ${counts.passing + counts.failing} runs passed`
            : "no results box";
        console.log(`  ${isStable(result) ? "✔" : "✖"} ${result.title} — ${verdict}`);
    });

    console.log(`\nScreenshots: ${outDir}`);

    const failed = results.filter(result => !isStable(result));
    if (failed.length === 0) {
        console.log(`\nEvery one of the ${results.length} test(s) passed all ${burn} runs.`);
        process.exit(0);
    }

    const screenshotsFolder = (await getCypressConfig(app, branding)).screenshotsFolder;
    console.log(`\n${failed.length} of ${results.length} test(s) did not pass every run:\n`);

    failed.forEach(result => {
        const counts = result.counts;
        console.log(`  ✖ ${result.title}`);
        console.log(
            counts
                ? `      ${counts.failing} of ${counts.passing + counts.failing} runs failed, the cypress screenshot of each is in ${screenshotsFolder}/${path.basename(result.spec)}/`
                : `      the run produced no (Results) box at all — see the .log in ${outDir}`,
        );
    });

    console.log(`\nBurn just those again:\n\n  ${rerunCommand(failed)}\n`);
    process.exit(1);
}

function rerunCommand(failed) {
    // repeat the command in the shape it was called in: yarn sets npm_lifecycle_event to the
    // name of the script it is running
    const entryPoint = process.env.npm_lifecycle_event
        ? `yarn ${process.env.npm_lifecycle_event}`
        : "node ./scripts/burn-changed-tests.mjs";

    const options = [
        entryPoint,
        `--burn ${burn}`,
        ...(retries === 0 ? [] : [`--retries ${retries}`]),
        ...(argv.app === "uc:default" ? [] : [`--app ${argv.app}`]),
        // the resolved base is pinned rather than left to be worked out again: --all keeps tests
        // in the selection that the plain diff would not hold, and --only can only filter them
        `--base ${base.ref}`,
        ...(argv.all ? ["--all"] : []),
        ...failed.map(result => `--only ${shellQuote(result.title)}`),
    ];

    return options.join(" ");
}

// a title is quoted for the shell the command is pasted into: a posix shell would expand a
// `${...}` of a double quoted title and run a `backtick` of it, and cmd.exe does not group with
// single quotes
function shellQuote(title) {
    return process.platform === "win32" ? JSON.stringify(title) : `'${title.replace(/'/g, `'\\''`)}'`;
}

// a test is stable when every run of it passed — a test that never ran at all is not stable,
// it is a test whose title the run could not find
function isStable(result) {
    return result.counts !== undefined && result.counts.failing === 0 && result.counts.passing > 0;
}

// cypress-grep splits its grep value on ";" and inverts a term that starts with "-"
// (see cypress-grep/src/utils.js), and an interpolated title is not the title at runtime
function isUnmatchable(title) {
    return title.includes(";") || title.includes("${") || title.trimStart().startsWith("-");
}

function countsOf(resultsBlock) {
    const read = label => {
        const match = resultsBlock.match(new RegExp(`${label}:\\s+(\\d+)`));
        return match ? Number(match[1]) : undefined;
    };

    return { passing: read("Passing") ?? 0, failing: read("Failing") ?? 0 };
}

/**
 * Works out what to diff against: an explicit `--base`, then the base branch of the open pull
 * request of this branch, then the default branch of the remote, then `origin/develop`.
 *
 * @returns {{ ref: string, source: string }}
 */
function resolveBase() {
    if (argv.base === "") {
        console.error("! --base needs a branch or a commit. Leave it out to have the base worked out.");
        process.exit(1);
    }

    if (argv.base) {
        return { ref: argv.base, source: "--base" };
    }

    const pullRequest = openPullRequest();
    if (pullRequest) {
        return { ref: remoteRef(pullRequest.baseRefName), source: `base of open PR #${pullRequest.number}` };
    }

    const remoteHead = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { allowFailure: true });
    if (remoteHead) {
        return { ref: remoteHead, source: "default branch of origin" };
    }

    return { ref: FALLBACK_BASE, source: "fallback, no PR and no origin/HEAD" };
}

/**
 * The open pull request of the current branch, read through the github cli. Anything in the way —
 * no `gh`, no authentication, no network, a detached HEAD, no pull request — means no answer, and
 * the caller falls back.
 *
 * @returns {{ number: number, baseRefName: string } | undefined}
 */
function openPullRequest() {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { allowFailure: true });
    if (!branch || branch === "HEAD") {
        return undefined;
    }

    try {
        const output = execFileSync(
            "gh",
            ["pr", "list", "--head", branch, "--state", "open", "--limit", "1", "--json", "number,baseRefName"],
            { cwd: repoRoot, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 },
        );
        return JSON.parse(output)[0];
    } catch {
        return undefined;
    }
}

// a pull request names its base as a branch — the diff has to be taken against the remote-tracking
// ref of it, since the local branch of the same name may be stale or missing altogether
function remoteRef(branch) {
    const remote = `origin/${branch}`;
    return git(["rev-parse", "--verify", "--quiet", remote], { allowFailure: true }) ? remote : branch;
}

function git(args, { cwd = cypressDir, allowFailure = false } = {}) {
    try {
        // core.quotePath=false: a path holding a non-ascii character comes back quoted and
        // octal-escaped otherwise, and the spec behind it would silently drop out of the run
        return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
            cwd,
            encoding: "utf-8",
            maxBuffer: 64 * 1024 * 1024,
            // a call that is allowed to fail keeps git's own complaint out of the output
            stdio: ["ignore", "pipe", allowFailure ? "ignore" : "inherit"],
        }).trim();
    } catch (error) {
        if (allowFailure) {
            return "";
        }
        throw error;
    }
}

function slug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function usage() {
    return `Burn the tests changed on this branch and screenshot the (Results) box of each run.

    Options:

    --base <ref>      branch to diff against (default: base of the open PR of this branch,
                      else the default branch of origin, else origin/develop)
    --burn <n>        repeats per test (default: 20)
    --app <a:brand>   application and branding (default: uc:default)
    --retries <n>     cypress retries, 0 keeps flakes visible (default: 0)
    --all             burn every test of a changed spec, not only the changed ones
    --only <text>     keep only the changed tests whose title holds <text>, can be repeated
    --out <dir>       output directory (default: results/burn/<timestamp>)
    --dry-run         list the tests that would be burned and stop
    --help            print this and stop

    Examples:

    --dry-run                      # what would run
    --burn 30                      # burn each changed test 30 times
    --burn 30 --only "some title"  # burn one test again
`;
}

/**
 * Finds every test of a spec file with the line range its declaration spans.
 *
 * @param {string} source contents of a `*.spec.ts` file
 * @returns {{ title: string, startLine: number, endLine: number, skipped: boolean }[]}
 */
function findTests(source) {
    const tests = [];
    const isCode = codePositions(source);
    TEST_DECLARATION.lastIndex = 0;

    let declaration;
    while ((declaration = TEST_DECLARATION.exec(source)) !== null) {
        const openParen = TEST_DECLARATION.lastIndex - 1;
        const title = readTitle(source, openParen + 1);
        // a commented out test, or one written inside a string, is not a test
        if (title === undefined || !isCode[declaration.index + declaration[1].length]) {
            continue;
        }

        const closeParen = findMatchingParen(source, openParen);
        const startLine = lineOf(source, declaration.index + declaration[1].length);
        const endLine = closeParen === -1 ? lineOf(source, source.length) : lineOf(source, closeParen);

        tests.push({ title, startLine, endLine, skipped: declaration[3] === ".skip" });
        TEST_DECLARATION.lastIndex = closeParen === -1 ? source.length : closeParen;
    }

    return tests;
}

/**
 * Reads the added (`+`) line numbers of every file of a unified diff.
 *
 * @param {string} diff output of `git diff --unified=0`
 * @returns {Record<string, number[]>} changed lines per file, empty for a file that only lost lines
 */
function changedLinesByFile(diff) {
    const changed = {};
    let file;

    for (const line of diff.split("\n")) {
        if (line.startsWith("+++ ")) {
            const path = line.slice("+++ ".length).trim();
            file = path === "/dev/null" ? undefined : path.replace(/^b\//, "");
            if (file) {
                changed[file] ??= [];
            }
            continue;
        }

        if (!file || !line.startsWith("@@")) {
            continue;
        }

        const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (!hunk) {
            continue;
        }

        const start = Number(hunk[1]);
        const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
        for (let offset = 0; offset < count; offset++) {
            changed[file].push(start + offset);
        }
    }

    return changed;
}

/**
 * Splits changed lines into the tests they belong to and the lines that belong to none
 * (a `beforeEach`, a helper, an import — code shared by every test of the spec).
 *
 * @param {{ title: string, startLine: number, endLine: number }[]} tests
 * @param {number[]} changedLines
 */
function selectChangedTests(tests, changedLines) {
    const holdsLine = test => changedLines.some(line => line >= test.startLine && line <= test.endLine);
    const belongsToATest = line => tests.some(test => line >= test.startLine && line <= test.endLine);

    return {
        tests: tests.filter(holdsLine),
        linesOutsideTests: changedLines.filter(line => !belongsToATest(line)),
    };
}

/**
 * Cuts the `(Results)` box — the summary table of a headless run — out of the cypress output.
 *
 * @param {string} output stdout of `cypress run`
 * @returns {string | undefined} the box, or undefined when the run never reached it
 */
function extractResultsBlock(output) {
    const lines = output.replace(ANSI, "").split("\n");
    const start = lines.findIndex(line => line.includes("(Results)"));
    if (start === -1) {
        return undefined;
    }

    const end = lines.findIndex((line, index) => index > start && line.includes("└"));
    if (end === -1) {
        return undefined;
    }

    return alignBox(lines.slice(start, end + 1).map(line => line.trimEnd())).join("\n");
}

/**
 * Cypress pads the box rows to a width that counts the ansi codes it colours the values with.
 * Once the codes are gone the right border of those rows sits too far left, so it is pushed back
 * to the width of the border rows.
 */
function alignBox(lines) {
    const width = Math.max(...lines.filter(line => /[┌└]/.test(line)).map(line => line.length), 0);

    return lines.map(line => {
        if (!/^\s*│.*│$/.test(line) || line.length >= width) {
            return line;
        }
        return `${line.slice(0, -1)}${" ".repeat(width - line.length)}│`;
    });
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function readTitle(source, from) {
    let index = skipTrivia(source, from);
    const quote = source[index];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
        return undefined;
    }

    let title = "";
    for (index++; index < source.length; index++) {
        const char = source[index];
        if (char === "\\") {
            title += source[index + 1] ?? "";
            index++;
            continue;
        }
        if (char === quote) {
            return title;
        }
        title += char;
    }

    return undefined;
}

/**
 * Marks every position of a source that is code — outside a comment and outside a string literal.
 *
 * @param {string} source
 * @returns {Uint8Array} 1 at a position that is code, 0 at one that is not
 */
function codePositions(source) {
    const isCode = new Uint8Array(source.length).fill(1);

    for (let index = 0; index < source.length; index++) {
        const char = source[index];

        if (char === '"' || char === "'" || char === "`") {
            const end = skipString(source, index);
            if (!opensAString(source, index, end)) {
                continue;
            }

            isCode.fill(0, index + 1, end);
            index = end;
            continue;
        }
        if (source.startsWith("//", index) || source.startsWith("/*", index)) {
            const end = skipTrivia(source, index);
            isCode.fill(0, index, end);
            index = end - 1;
        }
    }

    return isCode;
}

/**
 * A `'` or a `"` only opens a string when it closes on its own line — javascript forbids a raw
 * newline inside one. One that does not is a character of something else, a quote inside a regex
 * literal such as `/["']x/`, and reading a string from it would mark the rest of the file as
 * not code and drop every test after it. A backtick does span lines, so it is taken as it comes.
 */
function opensAString(source, start, end) {
    return source[start] === "`" || (end < source.length && !source.slice(start, end).includes("\n"));
}

function skipTrivia(source, from) {
    let index = from;

    while (index < source.length) {
        if (/\s/.test(source[index])) {
            index++;
        } else if (source.startsWith("//", index)) {
            const lineEnd = source.indexOf("\n", index);
            index = lineEnd === -1 ? source.length : lineEnd + 1;
        } else if (source.startsWith("/*", index)) {
            const commentEnd = source.indexOf("*/", index);
            index = commentEnd === -1 ? source.length : commentEnd + 2;
        } else {
            break;
        }
    }

    return index;
}

function findMatchingParen(source, openParen) {
    let depth = 0;

    for (let index = openParen; index < source.length; index++) {
        const char = source[index];

        if (char === '"' || char === "'" || char === "`") {
            index = skipString(source, index);
            continue;
        }
        if (source.startsWith("//", index) || source.startsWith("/*", index)) {
            index = skipTrivia(source, index) - 1;
            continue;
        }
        if (char === "(") {
            depth++;
        } else if (char === ")") {
            depth--;
            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

function skipString(source, start) {
    const quote = source[start];

    for (let index = start + 1; index < source.length; index++) {
        const char = source[index];
        if (char === "\\") {
            index++;
            continue;
        }
        if (char === quote) {
            return index;
        }
    }

    return source.length;
}

function lineOf(source, index) {
    let line = 1;
    for (let position = 0; position < index && position < source.length; position++) {
        if (source[position] === "\n") {
            line++;
        }
    }
    return line;
}
