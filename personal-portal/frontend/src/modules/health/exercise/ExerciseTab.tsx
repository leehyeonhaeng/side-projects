import { useMe } from "@/api/me";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GymPanel } from "./GymPanel";
import { ProgramPanel, TodayTraining } from "./ProgramPanel";
import { RunPanel } from "./RunPanel";

/** DESIGN.md 6.5 운동: 러닝 / 헬스 / 훈련 프로그램, 위에 오늘 할 훈련 */
export function ExerciseTab() {
  const me = useMe();
  const readOnly = me.data?.perms.health !== "edit";
  return (
    <div className="grid gap-4">
      <TodayTraining />
      <Tabs defaultValue="run">
        <TabsList>
          <TabsTrigger value="run">러닝</TabsTrigger>
          <TabsTrigger value="gym">헬스</TabsTrigger>
          <TabsTrigger value="program">훈련 프로그램</TabsTrigger>
        </TabsList>
        <TabsContent value="run" className="pt-3">
          <RunPanel readOnly={readOnly} />
        </TabsContent>
        <TabsContent value="gym" className="pt-3">
          <GymPanel readOnly={readOnly} />
        </TabsContent>
        <TabsContent value="program" className="pt-3">
          <ProgramPanel readOnly={readOnly} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
