import { redirect } from "next/navigation";

export default function ProjectFilesRedirectPage({ params }: { params: { projectId: string } }) {
  redirect(`/projects/${encodeURIComponent(params.projectId)}?tab=files`);
}


