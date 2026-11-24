import Link from "next/link";
import { getRepo } from "@core/db";
import { Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WebsitesPage() {
  const websites = await getRepo().listWebsites();
  return (
    <div>
      <PageHeader title="Websites" actions={<Link href="/websites/new" className="btn-primary">+ Add website</Link>} />
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Base URL</th><th>Access</th><th>Devices</th><th>Max pages</th><th>Updated</th></tr></thead>
          <tbody>
            {websites.map((w) => (
              <tr key={w.id}>
                <td><Link href={`/websites/${w.id}`} className="font-medium text-blue-700 hover:underline">{w.name}</Link></td>
                <td className="text-gray-600">{w.baseUrl}</td>
                <td>{w.settings.auth ? "Login" : "Public"}</td>
                <td>{w.settings.devices.join(", ")}</td>
                <td>{w.settings.maxPages}</td>
                <td className="text-gray-500">{fmtDate(w.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!websites.length && <div className="p-4"><Empty>No websites configured yet.</Empty></div>}
      </div>
    </div>
  );
}
