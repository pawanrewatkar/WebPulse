import Link from "next/link";
import { getRepo } from "@core/db";
import { Empty, PageHeader } from "@/components/ui";
import PaginatedTable from "@/components/Paginated";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WebsitesPage() {
  // Newest website first
  const websites = (await getRepo().listWebsites()).sort((a, b) => b.id - a.id);
  return (
    <div>
      <PageHeader title="Websites" actions={<Link href="/websites/new" className="btn-primary">+ Add website</Link>} />
      <PaginatedTable
        label="websites"
        headers={["Name", "Base URL", "Access", "Devices", "Pages", "Updated"]}
        rows={websites.map((w) => ({
          key: w.id,
          cells: (
            <>
              <td><Link href={`/websites/${w.id}`} className="font-medium text-blue-700 hover:underline">{w.name}</Link></td>
              <td className="text-gray-600">{w.baseUrl}</td>
              <td>{w.settings.auth ? "Login" : "Public"}</td>
              <td>{w.settings.devices.join(", ")}</td>
              <td>{w.settings.maxPages >= 1000 ? "Whole website" : `up to ${w.settings.maxPages}`}</td>
              <td className="text-gray-500">{fmtDate(w.updatedAt)}</td>
            </>
          ),
        }))}
        empty={<Empty>No websites configured yet.</Empty>}
      />
    </div>
  );
}
