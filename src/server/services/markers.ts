import { MarkersSchema, parseMarkers, type Marker } from "@/core/spec/markers";
import { json } from "../db";
import { assertProjectId } from "../ids";
import { mutateProject, type Actor } from "./mutation";

/** Replaces the project's timeline markers (beats/notes). Voice timing is never touched. */
export async function setMarkers(projectId: string, input: unknown, actor: Actor): Promise<Marker[]> {
  assertProjectId(projectId);
  const markers = [...MarkersSchema.parse(input)].sort((a, b) => a.time - b.time).map((m) => ({ ...m, time: Math.round(m.time * 1000) / 1000 }));
  return mutateProject(
    projectId,
    actor,
    async (tx) => {
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { markers: true } });
      const before = parseMarkers(project.markers).length;
      await tx.project.update({ where: { id: projectId }, data: { markers: json(markers) } });
      return {
        result: markers,
        activity: { type: "markers.update", message: before === markers.length ? `Updated ${markers.length} timeline markers` : `Timeline markers: ${before} → ${markers.length}` },
        historyLabel: markers.length > before ? "add marker" : markers.length < before ? "delete marker" : "edit markers",
      };
    },
    { history: { label: "edit markers", scope: ["markers"] } },
  );
}
