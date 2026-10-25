import { randomUUID } from "node:crypto";
import { conflict, notFound, semantic, staleVersion } from "../lib/errors";
import { cleanName, normalizeName } from "../lib/text";
import { audit, bumpDataRevision, type Tx } from "./projections";

type Context = { requestId?: string };

async function assertCategoryNameFree(tx: Tx, name: string, exceptId?: string) {
  const duplicate = await tx.category.findUnique({ where: { normalizedName: normalizeName(name) }, select: { id: true } });
  if (duplicate && duplicate.id !== exceptId) throw conflict("A category with this name already exists.");
}

export async function createCategory(tx: Tx, input: { name: string; icon: string; color: string }, ctx: Context) {
  const name = cleanName(input.name);
  if (!name) throw semantic("Enter a category name.", { name: ["Enter a category name."] });
  await assertCategoryNameFree(tx, name);
  const category = await tx.category.create({
    data: { id: randomUUID(), name, normalizedName: normalizeName(name), icon: input.icon, color: input.color, isSystem: false },
  });
  await bumpDataRevision(tx);
  await audit(tx, { action: "CREATE", entityType: "Category", entityId: category.id, after: category, requestId: ctx.requestId });
  return category;
}

export async function updateCategory(tx: Tx, id: string, expectedVersion: number, input: { name?: string; icon?: string; color?: string; archived?: boolean }, ctx: Context) {
  const before = await tx.category.findUnique({ where: { id } });
  if (!before) throw notFound("Category");
  if (before.isSystem) throw semantic("System categories cannot be changed.");
  if (before.version !== expectedVersion) throw staleVersion();
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name !== undefined) {
    if (!name) throw semantic("Enter a category name.", { name: ["Enter a category name."] });
    await assertCategoryNameFree(tx, name, id);
  }
  const updated = await tx.category.updateMany({
    where: { id, version: expectedVersion },
    data: {
      ...(name === undefined ? {} : { name, normalizedName: normalizeName(name) }),
      ...(input.icon === undefined ? {} : { icon: input.icon }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw staleVersion();
  await bumpDataRevision(tx);
  const after = await tx.category.findUniqueOrThrow({ where: { id } });
  await audit(tx, { action: "UPDATE", entityType: "Category", entityId: id, before, after, requestId: ctx.requestId });
  return after;
}

export async function createSubcategory(tx: Tx, input: { parentCategoryId: string; name: string }, ctx: Context) {
  const name = cleanName(input.name);
  const parent = await tx.category.findUnique({ where: { id: input.parentCategoryId } });
  if (!parent || parent.isSystem || parent.archivedAt) throw semantic("Choose an active category.", { parentCategoryId: ["Choose an active category."] });
  if (!name) throw semantic("Enter a subcategory name.", { name: ["Enter a subcategory name."] });
  const normalizedName = normalizeName(name);
  const duplicate = await tx.subcategory.findUnique({ where: { parentCategoryId_normalizedName: { parentCategoryId: parent.id, normalizedName } }, select: { id: true } });
  if (duplicate) throw conflict("A subcategory with this name already exists in that category.");
  const subcategory = await tx.subcategory.create({
    data: { id: randomUUID(), parentCategoryId: parent.id, name, normalizedName, isSystem: false },
  });
  await bumpDataRevision(tx);
  await audit(tx, { action: "CREATE", entityType: "Subcategory", entityId: subcategory.id, after: subcategory, requestId: ctx.requestId });
  return subcategory;
}

export async function updateSubcategory(tx: Tx, id: string, expectedVersion: number, input: { name?: string; archived?: boolean }, ctx: Context) {
  const before = await tx.subcategory.findUnique({ where: { id }, include: { parent: true } });
  if (!before) throw notFound("Subcategory");
  if (before.isSystem) throw semantic("System subcategories cannot be changed.");
  if (before.version !== expectedVersion) throw staleVersion();
  if (input.archived === false && before.parent.archivedAt) throw semantic("Restore the parent category first.");
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name !== undefined) {
    if (!name) throw semantic("Enter a subcategory name.", { name: ["Enter a subcategory name."] });
    const normalizedName = normalizeName(name);
    const duplicate = await tx.subcategory.findUnique({ where: { parentCategoryId_normalizedName: { parentCategoryId: before.parentCategoryId, normalizedName } }, select: { id: true } });
    if (duplicate && duplicate.id !== id) throw conflict("A subcategory with this name already exists in that category.");
  }
  const updated = await tx.subcategory.updateMany({
    where: { id, version: expectedVersion },
    data: {
      ...(name === undefined ? {} : { name, normalizedName: normalizeName(name) }),
      ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw staleVersion();
  await bumpDataRevision(tx);
  const after = await tx.subcategory.findUniqueOrThrow({ where: { id } });
  await audit(tx, { action: "UPDATE", entityType: "Subcategory", entityId: id, before, after, requestId: ctx.requestId });
  return after;
}