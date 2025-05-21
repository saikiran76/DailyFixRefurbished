import { Button } from "./button"
import LavaLamp from "./Loader/LavaLamp"

export function ButtonLoading() {
  return (
    <Button disabled>
      <LavaLamp className="w-[20px] h-[40px] mr-3" />
      Please wait
    </Button>
  )
}
