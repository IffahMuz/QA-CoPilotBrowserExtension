using Microsoft.EntityFrameworkCore;

namespace QaCopilot.Backend.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) {}
    public DbSet<BugReport> BugReports => Set<BugReport>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<BugReport>().HasIndex(r => r.CaptureId).IsUnique();
    }
}
