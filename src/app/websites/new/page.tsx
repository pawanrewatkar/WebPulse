import WebsiteForm from "@/components/WebsiteForm";
import { PageHeader } from "@/components/ui";

export default function NewWebsitePage() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Add website" subtitle="Only the configured domain is crawled; external domains are never crawled unless added below." />
      <WebsiteForm mode={{ kind: "create" }} />
    </div>
  );
}
