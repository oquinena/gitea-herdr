import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextView } from "gpui-base";
import { spaces, panes, focused, exec, theme, checking } from "herdr";
import { gtHosts, resolveRepo, loadIssues, loadIssue, filterIssues, labelNames, age } from "./gitea.js";

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
    const chip = text => div().max_w_full().truncate().px(5).py(1).rounded(4).bg(t.raised).text_size(11).child(text);
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
                .child(chip(issue.state))
                .children(labelNames(issue).map(chip)))
              .child(div().truncate().text_size(11).text_color(t.muted).child(`${issue.author} · ${age(issue.created_at)}`))
              .child(div().w_full().min_w(0).overflow_x_hidden().child(issue.body
                ? TextView.markdown(`issue-body-${issue.number}`, issue.body)
                : div().text_color(t.muted).child("No description."))),
            ...comments.map((comment, i) => v_flex().flex_none().w_full().min_w(0).p(12).gap(8).overflow_x_hidden()
              .child(div().truncate().text_size(11).text_color(t.muted).child(`${comment.author} · ${age(comment.created_at)}`))
              .child(div().w_full().min_w(0).overflow_x_hidden().child(TextView.markdown(`comment-${issue.number}-${i}`, comment.body)))),
          ]));
    }
    const issues = this.list.issues ?? [], filtered = filterIssues(issues, this.input.value());
    const message = this.list.state === "loading" ? "Loading…" : this.list.state === "error" ? this.list.message
      : !issues.length ? "No open issues" : !filtered.length ? "No issues match" : null;
    return panel
      .child(h_flex().flex_none().p(10).gap(8).items_center()
        .child(Input.new(this.input).flex_1().min_w(0).h(32).px(8).rounded(6).border_1().border_color(t.border).text_color(t.foreground))
        .child(button("issues-refresh", "↻", (_e, cx) => this.loadList(cx))))
      .child(div().flex_none().px(12).pb(8).truncate().text_color(t.muted).child(this.repo.root.split("/").filter(Boolean).pop() || this.repo.root))
      .child(v_flex().id("issues-list").flex_1().min_h(0).overflow_y_scrollbar()
        .children(message ? [div().p(12).whitespace_normal().text_color(t.muted).child(message)] : filtered.map(issue => {
          const labels = labelNames(issue);
          return v_flex().id(`issue-${issue.number}`).flex_none().p(10).gap(5).cursor_pointer().hover(s => s.bg(t.hover))
            .on_click((_e, cx) => this.openIssue(issue.number, cx))
            .child(h_flex().gap(8).items_center().min_w(0)
              .child(div().flex_none().text_color(t.muted).child(`#${issue.number}`))
              .child(div().flex_1().min_w(0).truncate().child(issue.title)))
            .when(labels.length > 0, el => el.child(h_flex().gap(4).flex_wrap().children(labels.map(chip))))
            .child(div().text_size(11).text_color(t.muted).child(`${issue.author} · ${age(issue.updated_at)}${issue.comments > 0 ? ` · ${issue.comments} comment${issue.comments === 1 ? "" : "s"}` : ""}`));
        })));
  }
}
