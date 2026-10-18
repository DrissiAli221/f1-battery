package dev.f1battery.api;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Resolves which (model_version, run_id) a request reads. Results are immutable per run. */
@Component
public class ModelRuns {

    public record Run(String modelVersion, UUID runId) {}

    private final JdbcTemplate jdbc;

    public ModelRuns(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The most recently written run, of the given version if one is named, else of any version. */
    public Optional<Run> resolve(String model) {
        List<Run> runs = jdbc.query(
                "select model_version, run_id from model_result"
                        + (model == null || model.isBlank() ? "" : " where model_version = ?")
                        + " group by model_version, run_id order by max(created_at) desc limit 1",
                (rs, i) -> new Run(rs.getString(1), rs.getObject(2, UUID.class)),
                model == null || model.isBlank() ? new Object[0] : new Object[] {model});
        return runs.stream().findFirst();
    }
}
