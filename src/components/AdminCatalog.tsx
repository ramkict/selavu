"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Pencil, Plus, RotateCcw, Search, X } from "lucide-react";
import { ApiError, apiRequest } from "./api";
import { ConfiguredMonthsPanel } from "./ConfiguredMonthsPanel";

type Subcategory = { id: string; name: string; isSystem: boolean; version: number; archivedAt: string | null };
type Category = { id: string; name: string; icon: string; color: string; isSystem: boolean; version: number; archivedAt: string | null; subcategories: Subcategory[] };
type Editor = { kind: "category"; category?: Category } | { kind: "subcategory"; category?: Category; subcategory?: Subcategory };

const ICONS = ["tag", "house", "shopping-basket", "car-front", "zap", "coffee", "heart", "briefcase", "circle-dollar-sign"];

export function AdminCatalog({ categories, months, currentMonth }: { categories: Category[]; months: string[]; currentMonth: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"categories" | "subcategories" | "months">("categories");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editor && !dialog.current?.open) dialog.current?.showModal();
    if (!editor && dialog.current?.open) dialog.current.close();
  }, [editor]);

  const editable = categories.filter((category) => !category.isSystem);
  const filteredCategories = editable.filter((category) => category.name.toLowerCase().includes(search.toLowerCase()));
  const filteredSubs = editable.flatMap((category) => category.subcategories
    .filter((subcategory) => !subcategory.isSystem && `${category.name} ${subcategory.name}`.toLowerCase().includes(search.toLowerCase()))
    .map((subcategory) => ({ ...subcategory, category })));
  const activeParents = editable.filter((category) => !category.archivedAt);
  const isEditing = editor?.kind === "category" ? !!editor.category : !!editor?.subcategory;
  const initialName = editor?.kind === "category" ? editor.category?.name ?? "" : editor?.kind === "subcategory" ? editor.subcategory?.name ?? "" : "";

  function openEditor(value: Editor) {
    setError(null);
    setEditor(value);
  }

  function closeEditor() {
    if (pending) return;
    setEditor(null);
  }

  async function save(form: HTMLFormElement) {
    if (!editor) return;
    setError(null);
    const values = new FormData(form);
    const name = String(values.get("name") ?? "").trim();
    if (!name) return setError("Enter a name.");
    start(async () => {
      try {
        if (editor.kind === "category") {
          const category = editor.category;
          const payload = { name, icon: String(values.get("icon")), color: String(values.get("color")) };
          if (category) await apiRequest("PATCH", `/categories/${category.id}`, { ...payload, expectedVersion: category.version });
          else await apiRequest("POST", "/categories", payload);
        } else {
          const subcategory = editor.subcategory;
          if (subcategory) await apiRequest("PATCH", `/subcategories/${subcategory.id}`, { name, expectedVersion: subcategory.version });
          else await apiRequest("POST", "/subcategories", { parentCategoryId: String(values.get("parentCategoryId")), name });
        }
        setEditor(null);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Could not save this definition.");
      }
    });
  }

  function toggleArchive(kind: "category" | "subcategory", item: Category | Subcategory) {
    const archived = !!item.archivedAt;
    if (archived && kind === "subcategory") {
      const parent = editable.find((category) => category.subcategories.some((subcategory) => subcategory.id === item.id));
      if (parent?.archivedAt) return setError("Restore the parent category before restoring this subcategory.");
    }
    setError(null);
    start(async () => {
      try {
        await apiRequest("PATCH", `/${kind === "category" ? "categories" : "subcategories"}/${item.id}`, { expectedVersion: item.version, archived: !archived });
        router.refresh();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Could not update this definition.");
      }
    });
  }

  return (
    <>
      <div className="page-heading">
        <div><h1>Administration</h1><p className="muted">{tab === "months" ? "Choose which months are available for planning and reports." : "Manage the categories used to classify transactions."}</p></div>
        {tab !== "months" ? <button type="button" className="primary" onClick={() => openEditor({ kind: tab === "categories" ? "category" : "subcategory" })}><Plus size={16} aria-hidden="true" />Add {tab === "categories" ? "category" : "subcategory"}</button> : null}
      </div>
      <nav className="tabbar" aria-label="Administration sections">
        <button type="button" aria-current={tab === "categories" ? "page" : undefined} onClick={() => setTab("categories")}>Categories</button>
        <button type="button" aria-current={tab === "subcategories" ? "page" : undefined} onClick={() => setTab("subcategories")}>Subcategories</button>
        <button type="button" aria-current={tab === "months" ? "page" : undefined} onClick={() => setTab("months")}>Months</button>
        <Link href="/accounts">Accounts</Link>
      </nav>
      {tab === "months" ? <ConfiguredMonthsPanel months={months} currentMonth={currentMonth} /> : <>
      <section className="panel" aria-label={tab === "categories" ? "Categories" : "Subcategories"}>
        <div className="panel-head"><div><h2>{tab === "categories" ? "Categories" : "Subcategories"}</h2><p>Archived definitions remain available in transaction history.</p></div><span className="badge none">{tab === "categories" ? filteredCategories.length : filteredSubs.length} shown</span></div>
        <div className="toolbar"><label className="search"><Search size={16} aria-hidden="true" /><span className="sr-only">Search definitions</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${tab}...`} /></label></div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {tab === "categories" ? <div className="table-wrap admin-table"><table><thead><tr><th>Name</th><th>Subcategories</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {filteredCategories.map((category) => <tr key={category.id}>
            <td><span className="report-category"><span style={{ backgroundColor: category.color }} />{category.name}</span></td><td>{category.subcategories.filter((subcategory) => !subcategory.isSystem).length}</td><td><span className={`badge ${category.archivedAt ? "none" : "che"}`}>{category.archivedAt ? "Archived" : "Active"}</span></td>
            <td><div className="table-action"><button className="icon-btn" type="button" title="Edit category" aria-label={`Edit ${category.name}`} onClick={() => openEditor({ kind: "category", category })}><Pencil size={15} /></button><button className="icon-btn" type="button" title={category.archivedAt ? "Restore category" : "Archive category"} aria-label={`${category.archivedAt ? "Restore" : "Archive"} ${category.name}`} onClick={() => toggleArchive("category", category)} disabled={pending}>{category.archivedAt ? <RotateCcw size={15} /> : <Archive size={15} />}</button></div></td>
          </tr>)}
        </tbody></table></div> : <div className="table-wrap admin-table"><table><thead><tr><th>Name</th><th>Parent category</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
          {filteredSubs.map((subcategory) => <tr key={subcategory.id}>
            <td>{subcategory.name}</td><td>{subcategory.category.name}</td><td><span className={`badge ${subcategory.archivedAt || subcategory.category.archivedAt ? "none" : "che"}`}>{subcategory.archivedAt ? "Archived" : subcategory.category.archivedAt ? "Parent archived" : "Active"}</span></td>
            <td><div className="table-action"><button className="icon-btn" type="button" title="Edit subcategory" aria-label={`Edit ${subcategory.name}`} onClick={() => openEditor({ kind: "subcategory", category: subcategory.category, subcategory })}><Pencil size={15} /></button><button className="icon-btn" type="button" title={subcategory.archivedAt ? "Restore subcategory" : "Archive subcategory"} aria-label={`${subcategory.archivedAt ? "Restore" : "Archive"} ${subcategory.name}`} onClick={() => toggleArchive("subcategory", subcategory)} disabled={pending}>{subcategory.archivedAt ? <RotateCcw size={15} /> : <Archive size={15} />}</button></div></td>
          </tr>)}
        </tbody></table></div>}
        {(tab === "categories" ? filteredCategories.length : filteredSubs.length) === 0 ? <p className="empty-state">No matching definitions.</p> : null}
      </section>
      <dialog ref={dialog} className="account-dialog admin-dialog" aria-labelledby="admin-dialog-title" onCancel={(event) => { event.preventDefault(); closeEditor(); }}>
        <div className="dialog-heading"><div><h2 id="admin-dialog-title">{isEditing ? "Edit" : "Add"} {editor?.kind ?? "definition"}</h2><p className="muted">Changes keep historical transactions intact.</p></div><button type="button" className="icon-btn" aria-label="Close dialog" onClick={closeEditor}><X size={18} /></button></div>
        {editor ? <form className="panel admin-form" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
          <div className="field"><label htmlFor="definition-name">Name</label><input id="definition-name" name="name" maxLength={80} defaultValue={initialName} required /></div>
          {editor.kind === "category" ? <>
            <div className="form-row"><div className="field"><label htmlFor="definition-icon">Icon</label><select id="definition-icon" name="icon" defaultValue={editor.category?.icon ?? "tag"}>{ICONS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></div><div className="field"><label htmlFor="definition-color">Color</label><input className="color-input" id="definition-color" name="color" type="color" defaultValue={editor.category?.color ?? "#087f77"} /></div></div>
          </> : editor.subcategory ? <p className="muted">Parent category: {editor.category?.name}. Reassignment is disabled.</p> : <div className="field"><label htmlFor="parent-category">Parent category</label><select id="parent-category" name="parentCategoryId" required>{activeParents.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="dialog-actions"><button type="button" className="secondary" onClick={closeEditor} disabled={pending}>Cancel</button><button className="primary" type="submit" disabled={pending || (editor.kind === "subcategory" && !editor.subcategory && !activeParents.length)}>{pending ? "Saving..." : "Save"}</button></div>
        </form> : null}
      </dialog>
      </>}
    </>
  );
}