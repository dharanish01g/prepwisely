export function ComingSoonScreen({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">This page hasn't been built yet.</p>
      </div>
    </div>
  );
}
