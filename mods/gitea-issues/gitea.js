export const LIST_ARGS = ["issue","list","-L","100","--json","number,title,labels,author,updated_at,comments","--no-input"];

export const viewArgs = number => ["issue","view",String(number),"--json","number,title,body,labels,author,state,created_at,url","--no-input"];
export const commentArgs = number => ["issue","comment","list",String(number),"-L","1000","--json","author,body,created_at","--no-input"];

export function remoteHost(url) {
  if (typeof url !== "string") return null;
  if (/^(https?|ssh):\/\//i.test(url)) {
    try {
      return new URL(url).hostname.toLowerCase() || null;
    } catch {
      return null;
    }
  }
  return url.match(/^[^\s/@:]+@([^\s/:]+):.+$/)?.[1].toLowerCase() ?? null;
}

export async function gtHosts(exec, on) {
  try {
    const result = await exec("gt", ["auth", "status", "--json", "host"], { on });
    if (result.code !== 0) return null;
    return JSON.parse(result.stdout).map(account => remoteHost(account.host)).filter(Boolean);
  } catch {
    return null;
  }
}

export async function resolveRepo(exec, { cwd, on }, hosts) {
  if (!cwd) return null;
  try {
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
    if (top.code !== 0) return null;
    const root = top.stdout.trim();
    const origin = await exec("git", ["remote", "get-url", "origin"], { cwd: root, on });
    if (origin.code !== 0) return null;
    const host = remoteHost(origin.stdout.trim());
    return host && hosts.includes(host) ? { root } : null;
  } catch {
    return null;
  }
}

export function describeFailure(result, error) {
  if (error !== undefined) {
    return `Could not run gt: ${error?.message ?? String(error)}. Is gt installed?`;
  }
  if (result && result.code !== 0) {
    const message = result.stderr.split(/\r?\n/).map(line => line.trim()).find(Boolean) || `gt exited with ${result.code}`;
    return /\blogin\b|token|\b401\b|unauthori[sz]ed/i.test(message) ? `${message}. Run gt auth login` : message;
  }
  return "Unexpected output from gt";
}

export async function runGt(exec, args, { cwd, on }) {
  let result;
  try {
    result = await exec("gt", args, { cwd, on });
  } catch (error) {
    return { ok: false, message: describeFailure(null, error) };
  }
  if (result.code !== 0) return { ok: false, message: describeFailure(result) };
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, message: describeFailure(result) };
  }
}

export const loadIssues = (exec, loc) => runGt(exec, LIST_ARGS, loc);

export async function loadIssue(exec, loc, number) {
  const [issue, comments] = await Promise.all([
    runGt(exec, viewArgs(number), loc),
    runGt(exec, commentArgs(number), loc),
  ]);
  if (!issue.ok) return issue;
  if (!comments.ok) return comments;
  return { ok: true, data: { issue: issue.data, comments: comments.data } };
}

export function labelNames(issue) {
  return (issue.labels ?? []).map(label => typeof label === "string" ? label : label.name);
}

export function labelCounts(issues) {
  const counts = new Map();
  for (const issue of issues) {
    const seen = new Set();
    for (const label of issue.labels ?? []) {
      const name = typeof label === "string" ? label : label.name;
      const color = typeof label.color === "string" && /^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : null;
      if (seen.has(name)) continue;
      seen.add(name);
      if (!counts.has(name)) counts.set(name, { name, color, count: 0 });
      counts.get(name).count++;
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function filterIssues(issues, query, label = null) {
  const needle = query.toLowerCase();
  return issues.filter(issue => {
    const names = labelNames(issue);
    return (typeof label !== "string" || !label || names.includes(label))
      && `#${issue.number} ${issue.title} ${names.join(" ")} ${issue.author}`.toLowerCase().includes(needle);
  });
}

export function age(iso, now = Date.now()) {
  const seconds = (now - Date.parse(iso)) / 1000;
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return `${Math.floor(weeks / 52)}y`;
}
