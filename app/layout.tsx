import type { Metadata } from "next";
// Combine all font imports into one line
import { Inter, Lilita_One } from "next/font/google";
import "./globals.css";

// Configure the main font for the body text
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Configure the logo font
const lilitaOne = Lilita_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-lilita-one",
});

export const metadata: Metadata = {
  title: "Herd Search",
  description: "Beat-Herder Friend Finder",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* Apply both font variables to the body */}
      <body className={`${inter.variable} ${lilitaOne.variable}`}>
        {children}
      </body>
    </html>
  );
}