import { useMemo, useState } from "react";
import { PencilIcon, SearchIcon } from "lucide-react";
import { AddCategoryDialog } from "@/components/add-category-dialog";
import { EditCategoryDialog } from "@/components/edit-category-dialog";
import { TableSkeletonRows } from "@/components/table-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Category, useCategories } from "@/lib/categories";

export function CategoriesScreen() {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);
  const { data: categories = [], isPending, error } = useCategories();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => [c.name, c.description ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [categories, query]);

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
          placeholder="Search by name or description"
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
              <TableHead>Description</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableSkeletonRows columns={["w-32", "w-64", "w-6 ml-auto"]} />
            ) : error || filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className={`h-24 text-center ${error ? "text-destructive" : "text-muted-foreground"}`}>
                  {error ? `Could not load categories: ${error.message}` : "No categories found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.description ?? "—"}</TableCell>
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
