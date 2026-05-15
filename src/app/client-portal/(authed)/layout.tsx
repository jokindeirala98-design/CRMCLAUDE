// Layout no usado — el grupo (authed) está vacío y existe sólo para no
// dejar archivos huérfanos que el sandbox no me deja borrar. Las páginas
// autenticadas usan `requirePortalSession()` directamente.
export default function UnusedGroupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
