import { Card, CardContent, CardHeader, CardTitle } from "@groot/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@groot/ui/tabs";
import { Textarea } from "@groot/ui/textarea";
import { Streamdown } from "streamdown";

/** The skill's markdown instructions: Edit, and a Preview of them. */
export function SkillInstructions({
  form,
  setForm,
}: {
  form: { description: string; body: string };
  setForm: (form: { description: string; body: string }) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Instructions</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="edit">
          <TabsList>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="edit" className="mt-4">
            <Textarea
              id="skill-body"
              rows={14}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              aria-label="Skill instructions (markdown)"
              placeholder="Write the skill's instructions in markdown…"
              className="min-h-72 font-mono"
            />
          </TabsContent>
          <TabsContent value="preview" className="mt-4">
            <div className="min-h-72 rounded-lg border p-4 text-sm">
              {form.body.trim() ? (
                <Streamdown>{form.body}</Streamdown>
              ) : (
                <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
