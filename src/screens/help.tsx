import { ROLE_HELP, type RoleHelp } from "@/lib/help";
import { roleNavItems } from "@/lib/nav";
import { useMyRoleIds } from "@/lib/roles";

function RoleSection({ roleId, help, onNavigate }: { roleId: string; help: RoleHelp; onNavigate: (page: string) => void }) {
  const pages = roleNavItems(roleId).filter((i) => help.pages[i.id]);

  return (
    <div className="rounded-none border p-4">
      <h2 className="text-sm font-medium">{help.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{help.summary}</p>

      <h3 className="mt-4 text-xs font-medium">Your pages</h3>
      {pages.length ? (
        <ul className="mt-2 flex flex-col gap-2">
          {pages.map(({ id, title, icon: Icon }) => (
            <li key={id} className="flex gap-2 text-sm">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => onNavigate(id)}>
                  {title}
                </button>
                <p className="text-muted-foreground">{help.pages[id]}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Your pages are still being built. They'll be listed here once ready.</p>
      )}

      {help.steps && (
        <>
          <h3 className="mt-4 text-xs font-medium">How it works</h3>
          <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
            {help.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

export function HelpScreen({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { data: roleIds } = useMyRoleIds();
  const roles = Object.keys(ROLE_HELP).filter((r) => roleIds?.includes(r));

  return (
    <div className="flex max-w-3xl flex-col gap-4 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold">Help</h1>
        <p className="text-sm text-muted-foreground">What your role is for and what each of your pages does.</p>
      </div>
      {roles.map((r) => (
        <RoleSection key={r} roleId={r} help={ROLE_HELP[r]} onNavigate={onNavigate} />
      ))}
    </div>
  );
}
