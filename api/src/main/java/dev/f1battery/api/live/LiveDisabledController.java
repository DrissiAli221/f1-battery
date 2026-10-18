package dev.f1battery.api.live;

import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Answers the live endpoint with a clear 404 while replay is off (the default), so the view can explain it. */
@RestController
@ConditionalOnProperty(name = "api.replay.enabled", havingValue = "false", matchIfMissing = true)
public class LiveDisabledController {

    @GetMapping("/api/live/{sessionKey}")
    public ResponseEntity<Map<String, String>> disabled() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "replay disabled"));
    }
}
