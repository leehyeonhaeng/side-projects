import { useSearchParams } from "react-router";
import { PageTitle } from "@/components/ModuleIcon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExerciseTab } from "./exercise/ExerciseTab";
import { MealTab } from "./meal/MealTab";
import { WeightTab } from "./weight/WeightTab";

/** DESIGN.md 5장 /health: 식단 | 체중 | 운동 (탭) */
export function HealthPage() {
  const [params] = useSearchParams();
  // 홈 위젯·빠른 추가에서 넘어온 입력 (?draft=현미밥 200g)
  const draft = params.get("draft") ?? undefined;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageTitle module="health" />
      <Tabs defaultValue={params.get("tab") ?? "meal"}>
        <TabsList>
          <TabsTrigger value="meal">식단</TabsTrigger>
          <TabsTrigger value="weight">체중</TabsTrigger>
          <TabsTrigger value="exercise">운동</TabsTrigger>
        </TabsList>
        <TabsContent value="meal" className="pt-3">
          <MealTab draft={draft} />
        </TabsContent>
        <TabsContent value="weight" className="pt-3">
          <WeightTab />
        </TabsContent>
        <TabsContent value="exercise" className="pt-3">
          <ExerciseTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}
