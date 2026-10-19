namespace QaCopilot.Backend.Teams;

public class TeamsWebhookNotifier : INotifier
{
    private readonly HttpClient _http;
    private readonly string? _webhook;

    public TeamsWebhookNotifier(HttpClient http, IConfiguration cfg)
    {
        _http    = http;
        _webhook = cfg["Teams:WebhookUrl"];
    }

    public async Task NotifyAsync(BugNotification n, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_webhook)) return;

        var severityEmoji = n.Severity?.ToLower() switch
        {
            "critical" => "🔴",
            "high"     => "🟠",
            "medium"   => "🟡",
            _          => "🟢",
        };

        // Adaptive Card payload — works with both Power Automate flows and
        // direct Teams Incoming Webhook connectors.
        var card = new
        {
            type        = "message",
            attachments = new[]
            {
                new
                {
                    contentType = "application/vnd.microsoft.card.adaptive",
                    content     = new
                    {
                        type    = "AdaptiveCard",
                        version = "1.4",
                        body    = new object[]
                        {
                            new
                            {
                                type   = "TextBlock",
                                text   = $"{severityEmoji} Bug Filed: {n.Title}",
                                weight = "Bolder",
                                size   = "Medium",
                                wrap   = true,
                            },
                            new
                            {
                                type    = "FactSet",
                                facts   = new object[]
                                {
                                    new { title = "Severity",    value = n.Severity             },
                                    new { title = "Priority",    value = n.Priority             },
                                    new { title = "Bug Type",    value = n.BugType   ?? "—"     },
                                    new { title = "Module",      value = n.Module               },
                                    new { title = "Environment", value = n.Environment ?? "—"   },
                                    new { title = "DMS Dealer ID", value = n.DmsDealerId ?? "—" },
                                    new { title = "Team",        value = n.AssignedTeam ?? "Unassigned" },
                                    new { title = "ADO ID",      value = $"#{n.AdoWorkItemId}"  },
                                },
                            },
                            new
                            {
                                type = "TextBlock",
                                text = $"**URL:** {n.TargetUrl ?? "—"}",
                                wrap = true,
                                size = "Small",
                            },
                            new
                            {
                                type = "TextBlock",
                                text = $"**Expected:** {n.Expected}\n**Observations:** {(n.Observations.Length > 0 ? string.Join(" | ", n.Observations) : "—")}",
                                wrap = true,
                                size = "Small",
                            },
                        },
                        actions = new object[]
                        {
                            new
                            {
                                type  = "Action.OpenUrl",
                                title = "Open in Azure DevOps",
                                url   = n.AdoWorkItemUrl,
                            },
                        },
                    },
                },
            },
        };

        try { await _http.PostAsJsonAsync(_webhook, card, ct); }
        catch (Exception) { /* best-effort — never fail filing because of Teams */ }
    }
}
