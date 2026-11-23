import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView } from "gpui-base";
import { spaces, panes, focused, exec, theme, checking, settings } from "herdr";
import { gtHosts, resolveRepo, loadIssues, loadIssue, filterIssues, labelCounts, age } from "./gitea.js";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

export default class GiteaIssues extends View {
  init(_props, cx) {
    this.input = InputState.new({ placeholder: "Filter issues" });
    this.input.on("change", (_e, cx) => cx.notify());
    this.view = { name: "list" };
    this.detail = null;
    this.label = null;
    this.hosts = {};
    this.loc = null;
    this.repo = undefined;
    this.key = null;
    this.list = { state: "loading" };
    this.resolveError = null;
    if (checking()) return;
    cx.timer.every(120000, (cx) => this.loadList(cx, true));
    this.resolve(cx);
  }

  resolve(cx) {
    if (checking()) return;
    const loc = location(), context = JSON.stringify(loc), hostKey = JSON.stringify(loc.on);
    this.loc = context;
    this.repo = undefined;
    this.resolveError = null;
    cx.spawn(async (cx) => {
      // Share an in-flight lookup too, so each machine is queried only once.
      if (!Object.hasOwn(this.hosts, hostKey)) this.hosts[hostKey] = gtHosts(exec, loc.on);
      const hosts = await this.hosts[hostKey];
      if (!hosts?.length) delete this.hosts[hostKey];
      const repo = hosts === null ? null : await resolveRepo(exec, loc, hosts);
      if (JSON.stringify(location()) !== context) return;
      this.repo = repo;
      this.resolveError = hosts === null ? "Could not run gt. Is gt installed?" : null;
      const key = repo ? JSON.stringify({ root: repo.root, on: loc.on }) : null;
      if (key !== this.key) {
        this.key = key;
        this.label = null;
        this.view = { name: "list" };
        await this.fetchList(cx);
      }
      cx.notify();
    });
  }

  loadList(cx, quiet = false) {
    cx.spawn((cx) => this.fetchList(cx, quiet));
  }

  // Await within spawned tasks because nested cx.spawn tasks never run.
  async fetchList(cx, quiet = false) {
    if (!this.repo) return;
    const key = this.key, { root, on } = JSON.parse(key);
    if (!quiet) {
      this.list = { state: "loading" };
      cx.notify();
    }
    const result = await loadIssues(exec, { cwd: root, on });
    if (this.key !== key) return;
    this.list = result.ok ? { state: "ready", issues: result.data } : { state: "error", message: result.message };
    cx.notify();
  }

  openIssue(number, cx) {
    const key = this.key, { root, on } = JSON.parse(key);
    const view = this.view = { name: "detail", number };
    this.detail = { state: "loading" };
    cx.notify();
    cx.spawn(async (cx) => {
      const result = await loadIssue(exec, { cwd: root, on }, number);
      if (this.key !== key || this.view !== view) return;
      this.detail = result.ok ? { state: "ready", ...result.data } : { state: "error", message: result.message };
      cx.notify();
    });
  }

  render(cx) {
    if (JSON.stringify(location()) !== this.loc) this.resolve(cx);
    const t = theme();
    const button = (id, label, onClick) => div().id(id).flex_none().p(4).cursor_pointer().hover(s => s.bg(t.hover)).on_click(onClick).child(label);
    const font = settings().font_family;
    const dot = color => div().flex_none().size(7).rounded_full().bg(color || t.muted);
    const pill = label => {
      const name = typeof label === "string" ? label : label.name;
      const color = typeof label.color === "string" && /^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : null;
      return div().max_w_full().truncate().px(6).py(1).rounded(4).border_1()
        .bg(color ? `${color}33` : t.raised).border_color(color || t.border).text_color(t.foreground).text_size(11).child(name);
    };
    if (!this.repo) {
      return div().size_full().when(Boolean(this.resolveError), el => el.p(12).text_color(t.muted).child(this.resolveError));
    }
    const panel = v_flex().id("gitea-issues").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13);
    if (this.view.name === "detail") {
      const { state, issue, comments, message } = this.detail;
      return panel
        .child(h_flex().flex_none().p(10).gap(8).items_center().min_w(0)
          .child(button("issues-back", "← Back", (_e, cx) => { this.view = { name: "list" }; cx.notify(); }))
          .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`#${this.view.number}`))
          .when(state === "ready", el => el.child(button("issue-browser", "Open in browser", (_e, cx) => cx.spawn(() => exec("open", [issue.url]))))))
        .child(v_flex().id(`issue-detail-${this.view.number}`).flex_1().min_h(0).min_w(0).w_full().overflow_y_scrollbar()
          .children(state !== "ready" ? [div().p(12).whitespace_normal().text_color(t.muted).child(state === "loading" ? "Loading…" : message)] : [
            v_flex().flex_none().w_full().min_w(0).p(12).gap(8).overflow_x_hidden()
              .child(div().w_full().min_w(0).whitespace_normal().font_semibold().child(issue.title))
              .child(h_flex().w_full().min_w(0).gap(4).flex_wrap()
                .child(pill(issue.state))
                .children((issue.labels ?? []).map(pill)))
              .child(div().truncate().text_size(11).when(typeof font === "string", el => el.font_family(font)).text_color(t.muted).child(`${issue.author} · ${age(issue.created_at)}`))
              .child(div().w_full().min_w(0).overflow_x_hidden().child(issue.body
                ? TextView.markdown(`issue-body-${issue.number}`, issue.body)
                : div().text_color(t.muted).child("No description."))),
            ...comments.map((comment, i) => v_flex().flex_none().w_full().min_w(0).p(12).gap(8).overflow_x_hidden()
              .child(div().truncate().text_size(11).when(typeof font === "string", el => el.font_family(font)).text_color(t.muted).child(`${comment.author} · ${age(comment.created_at)}`))
              .child(div().w_full().min_w(0).overflow_x_hidden().child(TextView.markdown(`comment-${issue.number}-${i}`, comment.body)))),
          ]));
    }
    const issues = this.list.issues ?? [], counts = labelCounts(issues);
    const chip = label => {
      const name = label?.name ?? null, active = this.label === name;
      return h_flex().id(label ? `issues-label-${name}` : "issues-all")
        .min_w(0).gap(4).items_center().rounded_full().px(8).py(2).text_size(11).border_1()
        .border_color(active ? t.accent : t.border)
        .when(active, el => el.bg(t.selected))
        .cursor_pointer().on_click((_e, cx) => { this.label = this.label === name ? null : name; cx.notify(); })
        .when(Boolean(label), el => el.child(dot(label.color)))
        .child(div().min_w(0).truncate().child(name ?? "all"))
        .child(div().flex_none().text_color(t.muted).child(String(label?.count ?? issues.length)));
    };
    if (this.list.state === "ready" && this.label !== null && !counts.some(label => label.name === this.label)) this.label = null;
    const filtered = filterIssues(issues, this.input.value(), this.label);
    const message = this.list.state === "loading" ? "Loading…" : this.list.state === "error" ? this.list.message
      : !issues.length ? "No open issues" : !filtered.length ? "No issues match" : null;
    return panel
      .child(h_flex().flex_none().p(10).gap(8).items_center().min_w(0)
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(this.repo.root.split("/").filter(Boolean).pop() || this.repo.root))
        .child(button("issues-refresh", "↻", (_e, cx) => this.loadList(cx))))
      .child(h_flex().flex_none().px(10).pb(10).gap(8)
        .children([{ name: "OPEN", count: issues.length }, ...counts.slice(0, 2)].map((label, i) =>
          v_flex().flex_1().min_w(0).p(8).gap(4).bg(t.surface).border_1().border_color(t.border).rounded(8)
            .child(h_flex().min_w(0).gap(4).items_center().text_size(10).text_color(t.muted)
              .when(i > 0, el => el.child(dot(label.color)))
              .child(div().min_w(0).truncate().child(label.name.toUpperCase())))
            .child(div().text_size(20).font_semibold().child(String(label.count))))))
      .child(div().flex_none().px(10).pb(10)
        .child(Input.new(this.input).w_full().min_w(0).h(32).px(8).rounded(6).border_1().border_color(t.border).text_color(t.foreground)))
      .when(this.list.state === "ready", el => el.child(h_flex().flex_none().px(10).pb(10).gap(6).flex_wrap()
        .child(chip(null)).children(counts.map(chip))))
      .child(v_flex().id("issues-list").flex_1().min_h(0).px(10).pb(10).gap(8).overflow_y_scrollbar()
        .children(message ? [div().p(12).whitespace_normal().text_color(t.muted).child(message)] : filtered.map(issue => {
          const labels = issue.labels ?? [];
          return v_flex().id(`issue-${issue.number}`).flex_none().min_w(0).p(10).gap(6)
            .bg(t.surface).border_1().border_color(t.border).rounded(8).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => this.openIssue(issue.number, cx))
            .when(labels.length > 0, el => el.child(h_flex().min_w(0).gap(4).flex_wrap().children(labels.map(pill))))
            .child(div().min_w(0).truncate().child(issue.title))
            .child(h_flex().min_w(0).text_size(11).when(typeof font === "string", el => el.font_family(font))
              .child(div().flex_none().text_color(t.accent).child(`#${issue.number}`))
              .child(div().min_w(0).truncate().text_color(t.muted).child(` · ${issue.author} · ${age(issue.updated_at)}${issue.comments > 0 ? ` · ${issue.comments} comment${issue.comments === 1 ? "" : "s"}` : ""}`)));
        })));
  }
}
