namespace QaCopilot.Backend.Evidence;

public record EvidenceManifest
{
    private readonly Dictionary<string, string> _files = new();
    public IReadOnlyDictionary<string, string> Files => _files;

    public void Add(string name, string path) => _files[name] = path;
}

public interface IEvidenceStore
{
    Task<EvidenceManifest> SaveAsync(Guid captureId, IFormFileCollection files);
    Task WriteJsonAsync(Guid captureId, string fileName, object payload, EvidenceManifest manifest);
    Task<Stream> OpenAsync(string path);
}
