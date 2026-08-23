import { redirect } from "next/navigation";

/**
 * 根路径自动跳转到工作台
 */
export default function RootPage() {
  redirect("/workspace");
}
