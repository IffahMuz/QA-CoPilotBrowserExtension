# ADO Test Case Steps Field Format

The `Microsoft.VSTS.TCM.Steps` field does **not** accept plain text or Markdown. It expects a specific XML structure where each step is a `<step>` element containing two `<parameterizedString>` elements — the action and the expected result. The whole thing is passed as a single string to `additionalFields`.

## Structure

```xml
<steps id="0" last="N">
  <step id="2" type="ActionStep">
    <parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;ACTION TEXT&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>
    <parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;EXPECTED RESULT TEXT&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>
    <description/>
  </step>
  <step id="3" type="ActionStep">
    <parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;ACTION 2&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>
    <parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;EXPECTED 2&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>
    <description/>
  </step>
</steps>
```

## Rules that matter

- **Step IDs start at 2** and increment by 1. The `<steps>` element's `last` attribute = the ID of the final step.
- **The inner HTML is escaped.** The action/expected content is HTML (`<DIV><P>...</P></DIV>`) but it lives inside an XML attribute-like text node, so the angle brackets are entity-encoded (`&lt;`, `&gt;`). When you build the string, escape the inner HTML.
- **First `parameterizedString` = Action**, second = **Expected Result**. Order is fixed.
- **`type="ActionStep"`** for normal steps. (`type="ValidateStep"` also exists but ActionStep with an expected result is the norm.)
- Put **preconditions** either in the work item's `Microsoft.VSTS.TCM.LocalDataSource`/description or as step 2 ("Log in to TCRM with Dealer ID X | Dashboard loads"). Simplest: make it the first step.

## Building it safely

When generating the string in code, build the inner HTML first, escape it, then assemble the `<step>` wrappers. A small Python helper:

```python
from xml.sax.saxutils import escape

def step(step_id, action, expected):
    a = escape(f"<DIV><P>{action}</P></DIV>")
    e = escape(f"<DIV><P>{expected}</P></DIV>")
    return (f'<step id="{step_id}" type="ActionStep">'
            f'<parameterizedString isformatted="true">{a}</parameterizedString>'
            f'<parameterizedString isformatted="true">{e}</parameterizedString>'
            f'<description/></step>')

def build_steps(pairs):  # pairs = [(action, expected), ...]
    steps = "".join(step(i + 2, a, e) for i, (a, e) in enumerate(pairs))
    return f'<steps id="0" last="{len(pairs) + 1}">{steps}</steps>'
```

## If the markup is rejected

Some ADO MCP tool versions sanitize or reject the Steps XML. If `create_work_item` errors on the Steps field or the steps don't render:

1. Create the work item **without** the Steps field first (title + tags + area only).
2. Put the full step table into the **`System.Description`** field as HTML instead (a normal `<table>` with #/Action/Expected columns). It won't render as native test steps but it's fully readable, and you tell the user the steps are in the Description.
3. Note to the user that native step rendering needs the Steps field, and they can paste the table into the Steps grid manually if they want the formal structure.

Always prefer the native Steps field; fall back only on error.
