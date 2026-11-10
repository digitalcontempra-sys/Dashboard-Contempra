-- Contour Cut: rolls printed with crop marks go back to the roll team to be cut (Graphtec / die cut).
-- It sits right after Laminate Roll in the production order.
UPDATE roles SET sort = 9 WHERE id = 'installer';
UPDATE roles SET sort = 8 WHERE id = 'finishing';
UPDATE roles SET sort = 7 WHERE id = 'colex';
UPDATE roles SET sort = 6 WHERE id = 'liquid_lam';
INSERT INTO roles (id, label, sort) VALUES ('contour_cut', 'Contour Cut', 5);
