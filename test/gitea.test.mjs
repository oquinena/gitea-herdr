import { test } from "node:test";
import assert from "node:assert/strict";
import { LIST_ARGS, viewArgs, commentArgs, remoteHost, gtHosts, resolveRepo, runGt, loadIssue, labelCounts, filterIssues, age } from "../mods/gitea-issues/gitea.js";

const fail = (code, stderr) => async () => ({ code, stdout: "", stderr });
const loc = { cwd: "/r/sub", on: null };

test("args", () => {
  assert.deepEqual(LIST_ARGS, ["issue","list","-L","100","--json","number,title,labels,author,updated_at,comments","--no-input"]);
  assert.deepEqual(viewArgs(7), ["issue","view","7","--json","number,title,body,labels,author,state,created_at,url","--no-input"]);
  assert.deepEqual(commentArgs(7), ["issue","comment","list","7","-L","1000","--json","author,body,created_at","--no-input"]);
});

test("remoteHost", () => {
  assert.equal(remoteHost("gitea@gitea.example.org:acme/app.git"), "gitea.example.org");
  assert.equal(remoteHost("https://Gitea.Example.org/acme/app.git"), "gitea.example.org");
  assert.equal(remoteHost("ssh://git@gitea.example.org:2222/a/b.git"), "gitea.example.org");
  assert.equal(remoteHost("https://github.com/oquinena/gitea-herdr.git"), "github.com");
  assert.equal(remoteHost("/local/path/repo.git"), null);
});

test("gtHosts runs gt auth status on the machine and returns hostnames", async () => {
  let seen;
  const exec = async (cmd, args, opts) => { seen = { cmd, args, opts }; return { code: 0, stdout: '[{"host":"https://gitea.example.org"}]', stderr: "" }; };
  assert.deepEqual(await gtHosts(exec, "vps"), ["gitea.example.org"]);
  assert.deepEqual(seen, { cmd: "gt", args: ["auth","status","--json","host"], opts: { on: "vps" } });
  assert.equal(await gtHosts(fail(1, "x"), null), null);
  assert.equal(await gtHosts(async () => { throw new Error("boom"); }, null), null);
  assert.equal(await gtHosts(async () => ({ code: 0, stdout: "nope", stderr: "" }), null), null);
  assert.deepEqual(await gtHosts(async () => ({ code: 0, stdout: "[]", stderr: "" }), null), []);
});

test("resolveRepo: gitea origin gives root, others give null", async () => {
  const git = (origin) => async (cmd, args, opts) => {
    assert.equal(cmd, "git");
    if (args.includes("--show-toplevel")) return { code: 0, stdout: "/r\n", stderr: "" };
    assert.equal(opts.cwd, "/r");
    return origin ? { code: 0, stdout: origin + "\n", stderr: "" } : { code: 2, stdout: "", stderr: "error: No such remote 'origin'" };
  };
  const hosts = ["gitea.example.org"];
  assert.deepEqual(await resolveRepo(git("gitea@gitea.example.org:a/b.git"), loc, hosts), { root: "/r" });
  assert.equal(await resolveRepo(git("https://github.com/a/b.git"), loc, hosts), null);
  assert.equal(await resolveRepo(git(null), loc, hosts), null);
  assert.equal(await resolveRepo(fail(128, "fatal: not a git repository"), loc, hosts), null);
  assert.equal(await resolveRepo(async () => { throw "boom"; }, loc, hosts), null);
  assert.equal(await resolveRepo(git("gitea@gitea.example.org:a/b.git"), { cwd: null, on: null }, hosts), null);
});

test("runGt passes cwd and on to exec and parses JSON", async () => {
  let seen;
  const exec = async (cmd, args, opts) => { seen = { cmd, args, opts }; return { code: 0, stdout: "[1]", stderr: "" }; };
  assert.deepEqual(await runGt(exec, LIST_ARGS, { cwd: "/r", on: "vps" }), { ok: true, data: [1] });
  assert.deepEqual(seen, { cmd: "gt", args: LIST_ARGS, opts: { cwd: "/r", on: "vps" } });
});

test("failure messages", async () => {
  const msg = async (exec) => (await runGt(exec, LIST_ARGS, loc)).message;
  assert.equal(await msg(async () => { throw new Error("spawn gt ENOENT"); }), "Could not run gt: spawn gt ENOENT. Is gt installed?");
  assert.equal(await msg(async () => { throw "unreachable"; }), "Could not run gt: unreachable. Is gt installed?");
  assert.equal(await msg(fail(1, "Error: 401 Unauthorized\nmore")), "Error: 401 Unauthorized. Run gt auth login");
  assert.equal(await msg(fail(1, "Error: token expired")), "Error: token expired. Run gt auth login");
  assert.equal(await msg(fail(1, "Error: 404 Not Found")), "Error: 404 Not Found");
  assert.equal(await msg(fail(1, "\nError: boom\nmore")), "Error: boom");
  assert.equal(await msg(fail(3, "")), "gt exited with 3");
  assert.equal(await msg(async () => ({ code: 0, stdout: "nope", stderr: "" })), "Unexpected output from gt");
});

test("loadIssue returns issue and comments", async () => {
  const exec = async (_c, args) => ({ code: 0, stdout: JSON.stringify(args[1] === "view" ? { number: 3 } : [{ body: "c" }]), stderr: "" });
  assert.deepEqual(await loadIssue(exec, loc, 3), { ok: true, data: { issue: { number: 3 }, comments: [{ body: "c" }] } });
});

test("filterIssues matches number, title, labels, author, case-insensitive", () => {
  const issues = [
    { number: 12, title: "Fix Login", labels: [{ name: "bug" }], author: "alice" },
    { number: 3, title: "Docs", labels: ["chore"], author: "bob" },
  ];
  assert.equal(filterIssues(issues, "").length, 2);
  assert.deepEqual(filterIssues(issues, "login").map(i => i.number), [12]);
  assert.deepEqual(filterIssues(issues, "#3").map(i => i.number), [3]);
  assert.deepEqual(filterIssues(issues, "BUG").map(i => i.number), [12]);
  assert.deepEqual(filterIssues(issues, "chore").map(i => i.number), [3]);
  assert.deepEqual(filterIssues(issues, "bob").map(i => i.number), [3]);
  assert.deepEqual(filterIssues(issues, "zzz"), []);
});

test("age", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  assert.equal(age("2026-11-21T11:59:30Z", now), "now");
  assert.equal(age("2026-11-21T11:55:00Z", now), "5m");
  assert.equal(age("2026-11-21T09:00:00Z", now), "3h");
  assert.equal(age("2026-11-19T12:00:00Z", now), "2d");
  assert.equal(age("2026-10-24T12:00:00Z", now), "4w");
  assert.equal(age("2025-11-01T12:00:00Z", now), "1y");
});

test("labelCounts counts, colors and sorts", () => {
  const issues = [
    { labels: [{ name: "bug", color: "ee0701" }, { name: "low", color: "bfe5bf" }] },
    { labels: [{ name: "bug", color: "ee0701" }] },
    { labels: ["chore"] },
    { labels: [] },
  ];
  assert.deepEqual(labelCounts(issues), [
    { name: "bug", color: "#ee0701", count: 2 },
    { name: "chore", color: null, count: 1 },
    { name: "low", color: "#bfe5bf", count: 1 },
  ]);
});

test("filterIssues by label combines with the query", () => {
  const issues = [
    { number: 1, title: "Login", labels: [{ name: "bug", color: "ee0701" }], author: "a" },
    { number: 2, title: "Login docs", labels: [{ name: "docs", color: "0000ff" }], author: "b" },
  ];
  assert.deepEqual(filterIssues(issues, "", "bug").map(i => i.number), [1]);
  assert.deepEqual(filterIssues(issues, "login", "docs").map(i => i.number), [2]);
  assert.deepEqual(filterIssues(issues, "login", null).map(i => i.number), [1, 2]);
  assert.deepEqual(filterIssues(issues, "", "nope"), []);
});

test("labelCounts counts each issue once and validates colors", () => {
  assert.deepEqual(labelCounts([
    { labels: ["bug", "bug"] },
    { labels: [{ name: "upper", color: "ABC123" }, { name: "short", color: "abc" },
      { name: "prefix", color: "#123456" }, { name: "number", color: 123456 },
      { name: "invalid", color: "zzzzzz" }] },
    {},
  ]), [
    { name: "bug", color: null, count: 1 },
    { name: "invalid", color: null, count: 1 },
    { name: "number", color: null, count: 1 },
    { name: "prefix", color: null, count: 1 },
    { name: "short", color: null, count: 1 },
    { name: "upper", color: "#ABC123", count: 1 },
  ]);
  assert.deepEqual(labelCounts([]), []);
});

test("filterIssues label matching is exact and empty labels keep text filtering", () => {
  const issues = [
    { number: 1, title: "Login", labels: ["bug"], author: "a" },
    { number: 2, title: "Other", labels: ["bugfix"], author: "b" },
    { number: 3, title: "Login", author: "c" },
  ];
  assert.deepEqual(filterIssues(issues, "LOGIN", "bug").map(i => i.number), [1]);
  assert.deepEqual(filterIssues(issues, "Other", "bug"), []);
  assert.deepEqual(filterIssues(issues, "", "BUG"), []);
  assert.deepEqual(filterIssues(issues, "LOGIN", "").map(i => i.number), [1, 3]);
});
