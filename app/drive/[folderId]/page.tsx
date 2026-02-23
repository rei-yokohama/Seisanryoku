"use client";

import { useParams } from "next/navigation";
import { DrivePage } from "../page";

export default function DriveSubFolderPage() {
  const params = useParams<{ folderId: string }>();
  return <DrivePage folderId={params.folderId} />;
}
