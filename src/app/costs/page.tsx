import type { Metadata } from "next";
import { BudgetForm } from "@/components/BudgetForm";
import { BudgetPanel } from "@/components/BudgetPanel";
import { Table, Td, Th } from "@/components/ui/misc";
import { budgetStatus, getCommon, getCostRows } from "@/lib/app";
import { requireAdminPage } from "@/lib/auth/guard";
import { MICROS, usd } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Costs and budget" };

export default async function CostsPage() {
  await requireAdminPage();
  const [status, common, costs] = await Promise.all([budgetStatus(), getCommon(), getCostRows()]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-20 font-semibold">Costs and budget</h1>
        <p className="mt-1 max-w-3xl text-mute">
          Every paid request is held to a cap per run ({usd(common.capMicros)}, set in the config), then to a daily and a monthly budget. Each call reserves its list price first and settles to the real cost.
        </p>
      </div>
      <BudgetPanel status={status} />
      <BudgetForm key={`${status.limits.dailyMicros}:${status.limits.monthlyMicros}`} dailyUsd={status.limits.dailyMicros / MICROS} monthlyUsd={status.limits.monthlyMicros / MICROS} disabled={common.demo} />
      <section aria-label="Stored answers" className="grid gap-2">
        <h2 className="text-16 font-medium">Stored answers, {usd(costs.totalMicros)} in total</h2>
        {costs.rows.length === 0 ? (
          <p className="rounded-panel border border-dashed border-line-strong p-8 text-center text-mute">No answers stored yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Provider</Th>
                <Th>Answers</Th>
                <Th>Pending</Th>
                <Th>Failed</Th>
                <Th>Charged</Th>
              </tr>
            </thead>
            <tbody>
              {costs.rows.map((r) => (
                <tr key={r.providerId}>
                  <Td>{r.providerId}</Td>
                  <Td className="num">{r.answers}</Td>
                  <Td className="num">{r.pending}</Td>
                  <Td className="num">{r.failed}</Td>
                  <Td className="num">{usd(r.costMicros)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
