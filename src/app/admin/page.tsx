import { AdminCatalog } from "@/components/AdminCatalog";
import { getDb } from "@/server/db";
import { getSettings, listCategories } from "@/server/domain/reference";
import { listConfiguredMonths } from "@/server/domain/months";
import { todayIn } from "@/server/lib/calendar";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const db = await getDb();
  const data = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    return {
      categories: await listCategories(tx),
      months: await listConfiguredMonths(tx),
      currentMonth: todayIn(settings.timezone).slice(0, 7),
    };
  });
  return <AdminCatalog {...data} />;
}