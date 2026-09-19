import { useMemo, useState } from "react";
import { PencilIcon, SearchIcon } from "lucide-react";
import { AddCategoryDialog } from "@/components/add-category-dialog";
import { EditCategoryDialog } from "@/components/edit-category-dialog";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildCategoryRows, type Category, useCategories } from "@/lib/categories";

export function CategoriesScreen() {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);
  const { data: categories = [], isPending, error } = useCategories();

  const rows = useMemo(() => buildCategoryRows(categories), [categories]);
  const parentName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ category: c, path }) =>
      [path, c.slug, c.description ?? ""].some((v) => v.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="text-sm text-muted-foreground">View and manage the categories that organise the question bank.</p>
        </div>
        <AddCategoryDialog />
      </div>

      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, slug or description"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableSkeletonRows columns={["w-32", "w-28", "w-28", "w-48", "w-16", "w-6 ml-auto"]} />
            ) : error || filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                  {error ? `Could not load categories: ${error.message}` : "No categories found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(({ category: c, depth }) => (
                <TableRow key={c.id}>
                  {/* Rows are ordered parent-then-children; indent shows the level. */}
                  <TableCell className="font-medium" style={{ paddingLeft: `${0.5 + (query ? 0 : depth) * 1.25}rem` }}>
                    {c.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                  <TableCell>{c.parent_id ? (parentName.get(c.parent_id) ?? "—") : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.description ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "active" : "inactive"}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>
                        <PencilIcon />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <EditCategoryDialog category={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
