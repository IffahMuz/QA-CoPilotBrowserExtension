namespace QaCopilot.Backend.Teams;

public interface INotifier
{
    Task NotifyAsync(BugNotification n, CancellationToken ct = default);
}

public record BugNotification(
    string   Title,
    string   Severity,
    string   Priority,
    string   Module,
    string?  BugType,
    string?  Environment,
    string?  DealerId,
    string?  DmsDealerId,
    string?  TargetUrl,
    string?  AssignedTeam,
    long     AdoWorkItemId,
    string   AdoWorkItemUrl,
    string?  Expected,
    string[] Observations
);
