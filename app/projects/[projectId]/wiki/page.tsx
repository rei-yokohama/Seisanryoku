import { redirect } from "next/navigation";

export default function ProjectWikiRedirectPage({ params }: { params: { projectId: string } }) {
  redirect(`/projects/${encodeURIComponent(params.projectId)}?tab=wiki`);
}


