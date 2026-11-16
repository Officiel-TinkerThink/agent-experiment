import json
import sys

# Reads one claude -p --output-format json result from stdin and prints its input token totals.
label = sys.argv[1] if len(sys.argv) > 1 else "run"
d = json.load(sys.stdin)
u = d.get("usage", {})
new = u.get("input_tokens", 0)
write = u.get("cache_creation_input_tokens", 0)
read = u.get("cache_read_input_tokens", 0)
print(
    f"{label}: input_total={new + write + read} (new={new}, cache_write={write}, cache_read={read}) "
    f"output={u.get('output_tokens')} is_error={d.get('is_error')} cost={d.get('total_cost_usd')}"
)
