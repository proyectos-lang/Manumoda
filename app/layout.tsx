import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { AuthProvider } from "@/lib/auth-context"
import "./globals.css"

const _inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Manufacturas de la Moda",
  description: "Sistema de Producción - Manufacturas de la Moda",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className="bg-background">
      <body className="font-sans antialiased">
        <AuthProvider>
          {children}
          {process.env.NODE_ENV === "production" && <Analytics />}
        </AuthProvider>
      </body>
    </html>
  )
}
