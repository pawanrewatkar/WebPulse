import { notFound } from "next/navigation";
import { getRepo } from "@core/db";
import WebsiteForm from "@/components/WebsiteForm";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EditWebsitePage({ params }: { params: Promise<{ id: string }> }) {
  const website = await getRepo().getWebsite(Number((await params).id));
  if (!website) notFound();
  return (
    <div className="max-w-5xl">
      <PageHeader title={`Settings – ${website.name}`} subtitle="Changes apply to future crawls. Existing baselines keep the settings they were captured with." />
      <WebsiteForm mode={{ kind: "edit", website }} />
    </div>
  );
}
