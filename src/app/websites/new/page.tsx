import WebsiteForm from "@/components/WebsiteForm";
import { PageHeader } from "@/components/ui";

export default function NewWebsitePage() {
  return (
    <div className="max-w-5xl">
      <PageHeader title="Add website" subtitle="Only pages on this website's domain are checked. Links to other websites are never crawled." />
      <WebsiteForm mode={{ kind: "create" }} />
    </div>
  );
}
