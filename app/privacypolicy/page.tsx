import React from "react";
import Image from "next/image";
import Link from "next/link";
import fs from "fs";
import path from "path";
import styles from "./privacy.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Herd Search",
  description: "Privacy Policy for the Herd Search mobile and web applications.",
};

export default function PrivacyPolicyPage() {
  // Read the HTML content of the policy file that was saved by the user
  let htmlContent = "";
  try {
    const filePath = path.join(process.cwd(), "app", "privacypolicy", "policy.html");
    htmlContent = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.error("Error reading policy.html:", error);
    htmlContent = "<p>Privacy policy content is currently unavailable.</p>";
  }

  return (
    <div className={styles.container}>
      {/* --- HEADER --- */}
      <header className={styles.header}>
        <div className={styles.logo}>
          <Image src="/logo-main.png" alt="Logo" width={40} height={40} className={styles.logoImage} />
          <span>
            <span style={{ color: "#a855f7" }}>Herd</span> <span style={{ color: "#22d3ee" }}>Search</span>
          </span>
        </div>
        <Link href="/" className={styles.backButton}>
          Back to App
        </Link>
      </header>

      {/* --- CONTENT CONTAINER --- */}
      <main className={styles.documentWrapper}>
        <div dangerouslySetInnerHTML={{ __html: htmlContent }} />
      </main>

      <footer className={styles.footer}>
        &copy; {new Date().getFullYear()} Herd Search. All rights reserved.
      </footer>
    </div>
  );
}
